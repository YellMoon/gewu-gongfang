const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { getInstance } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');
const { createDesktopIdentityService } = require('../services/desktopIdentityService');
const { createDesktopSessionService } = require('../services/desktopSessionService');
const {
  createDesktopDeviceChallengeService,
  createDesktopOfflineLease,
  createDesktopSessionProfile,
} = require('../services/desktopDeviceChallengeService');
const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const {
  resolveWechatIdentity: defaultResolveWechatIdentity,
  resolveWechatPhoneNumber: defaultResolveWechatPhoneNumber,
  createDesktopAuthorizationUrlLink: defaultCreateDesktopAuthorizationUrlLink,
} = require('../services/wechatMiniappService');

const START_KEYS = new Set(['deviceId', 'deviceName', 'publicKey', 'keyFingerprint', 'purpose']);
const CONFIRM_KEYS = new Set(['code', 'phoneCode', 'expectedRowVersion']);
const APPROVE_KEYS = new Set(['expectedRowVersion']);
const REJECT_KEYS = new Set(['expectedRowVersion', 'reason']);
const EXCHANGE_KEYS = new Set(['challengeSecret', 'signature', 'expectedRowVersion']);
const REVOKE_KEYS = new Set(['expectedRowVersion', 'reason']);
const ROLE_SWITCH_KEYS = new Set([
  'activeRole',
  'elevationIssuedAt',
  'elevationSignature',
]);
const SESSION_CHALLENGE_START_KEYS = new Set(['authorizationId', 'deviceId']);
const SESSION_CHALLENGE_EXCHANGE_KEYS = new Set(['signature', 'expectedRowVersion']);

function routeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertBodyKeys(body, allowedKeys) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw routeError('DESKTOP_IDENTITY_INPUT_INVALID');
  }
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) throw routeError('DESKTOP_IDENTITY_INPUT_FORBIDDEN');
  }
}

function bearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) throw routeError('DESKTOP_SESSION_REQUIRED');
  const token = authorization.slice(7).trim();
  if (!token) throw routeError('DESKTOP_SESSION_REQUIRED');
  return token;
}

function statusForError(error, authenticationPhase = false) {
  const code = String(error?.code || 'DESKTOP_IDENTITY_FAILED');
  if (code === 'WECHAT_CONFIG_REQUIRED') return 503;
  if (code.startsWith('WECHAT_') && (code.endsWith('_FAILED') || code.endsWith('_TIMEOUT'))) return 502;
  if (code === 'DESKTOP_SESSION_CHALLENGE_NOT_FOUND') return 404;
  if (code === 'DESKTOP_SESSION_CHALLENGE_REPLAYED'
    || code === 'DESKTOP_SESSION_CHALLENGE_EXPIRED'
    || code === 'DESKTOP_SESSION_CHALLENGE_STALE'
    || code === 'DESKTOP_SESSION_CHALLENGE_STATE_INVALID'
    || code === 'DESKTOP_SESSION_CHALLENGE_CREDENTIAL_CHANGED') return 409;
  if (code === 'DESKTOP_SESSION_CHALLENGE_SIGNATURE_REQUIRED'
    || code === 'DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID') return 401;
  if (authenticationPhase || code === 'DESKTOP_SESSION_REQUIRED'
    || code.startsWith('DESKTOP_SESSION_')) return 401;
  if (code === 'DESKTOP_IDENTITY_INPUT_FORBIDDEN'
    || code === 'DESKTOP_IDENTITY_INPUT_INVALID') return 400;
  if (code === 'DESKTOP_CHALLENGE_NOT_FOUND' || code === 'DESKTOP_DEVICE_NOT_FOUND') return 404;
  if (code.includes('FORBIDDEN')
    || code.includes('ROLE_REQUIRED')
    || code.includes('RECENT_')
    || code === 'DESKTOP_PHONE_REVERIFICATION_REQUIRED'
    || code === 'DESKTOP_DEVICE_AUTHORIZATION_MISMATCH'
    || code.startsWith('DESKTOP_ROLE_ELEVATION_')
    || code === 'ACTIVE_ROLE_NOT_GRANTED'
    || code === 'DESKTOP_IDENTITY_NOT_ELIGIBLE') return 403;
  if (code.includes('STALE')
    || code.includes('CONFLICT')
    || code.includes('ALREADY')
    || code.includes('REPLAY')
    || code.includes('STATE_INVALID')
    || code === 'DESKTOP_ACTIVE_ROLE_UNCHANGED'
    || code === 'DESKTOP_DEVICE_NOT_ACTIVE') return 409;
  return 400;
}

function sendError(res, error, authenticationPhase = false) {
  const code = String(error?.code || 'DESKTOP_IDENTITY_FAILED');
  return res.status(statusForError(error, authenticationPhase)).json({ success: false, code });
}

function createDesktopIdentityRouter({
  db,
  jwtSecret = JWT_SECRET,
  now,
  identityService,
  sessionService,
  deviceChallengeService,
  miniappIdentityService,
  authenticateDesktop,
  resolveWechatIdentity = defaultResolveWechatIdentity,
  resolveWechatPhoneNumber = defaultResolveWechatPhoneNumber,
  createDesktopAuthorizationUrlLink = defaultCreateDesktopAuthorizationUrlLink,
  challengeIdFactory = uuidv4,
  allowDesktopAuthorizationUrlFallback = process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'prod',
} = {}) {
  const database = db || getInstance().db;
  let identities = identityService || null;
  let sessions = sessionService || null;
  let deviceChallenges = deviceChallengeService || null;
  let miniappIdentities = miniappIdentityService || null;
  function identity() {
    if (!identities) identities = createDesktopIdentityService({ db: database, now });
    return identities;
  }
  function session() {
    if (!sessions) sessions = createDesktopSessionService({ db: database, jwtSecret, now });
    return sessions;
  }
  function dailyChallenge() {
    if (!deviceChallenges) {
      deviceChallenges = createDesktopDeviceChallengeService({
        db: database,
        sessionService: session(),
        now,
      });
    }
    return deviceChallenges;
  }
  function miniappIdentity() {
    if (!miniappIdentities) {
      miniappIdentities = createMiniappIdentityService({ db: database, jwtSecret, now });
    }
    return miniappIdentities;
  }
  const verifyDesktop = authenticateDesktop || function (token) {
    return session().verifySessionToken(token);
  };
  const router = Router();

  function authenticated(handler) {
    return async function (req, res) {
      let context;
      try {
        context = await verifyDesktop(bearerToken(req));
      } catch (error) {
        return sendError(res, error, true);
      }
      try {
        return await handler(req, res, context);
      } catch (error) {
        return sendError(res, error);
      }
    };
  }

  router.post('/challenges/start', async function (req, res) {
    try {
      assertBodyKeys(req.body, START_KEYS);
      const challengeId = String(challengeIdFactory()).trim();
      const challenge = identity().startChallenge(req.body, { challengeId });
      let qrValue = null;
      try {
        qrValue = await createDesktopAuthorizationUrlLink({ challengeId: challenge.id });
      } catch (error) {
        if (!allowDesktopAuthorizationUrlFallback) {
          identity().abandonPendingChallenge(challenge.id);
          throw error;
        }
      }
      return res.json({ success: true, data: { challenge: { ...challenge, qrValue } } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/challenges/:id', function (req, res) {
    try {
      const challenge = identity().readPublicChallenge(req.params.id);
      return res.json({ success: true, data: { challenge } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/challenges/:id/public', function (req, res) {
    try {
      const challenge = identity().readMiniappChallenge(req.params.id);
      return res.json({ success: true, data: { challenge } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/challenges/:id/confirm', async function (req, res) {
    try {
      assertBodyKeys(req.body, CONFIRM_KEYS);
      const code = String(req.body.code || '').trim();
      const phoneCode = String(req.body.phoneCode || '').trim();
      if (!code || !phoneCode) throw routeError('VERIFIED_WECHAT_IDENTITY_REQUIRED');
      const publicChallenge = identity().readMiniappChallenge(req.params.id);
      if (publicChallenge.status !== 'pending_phone') {
        throw routeError('DESKTOP_CHALLENGE_STATE_INVALID');
      }
      const wechat = await resolveWechatIdentity(code);
      const phone = await resolveWechatPhoneNumber(phoneCode);
      const login = miniappIdentity().loginWithVerifiedWechat({
        openid: wechat.openid,
        unionid: wechat.unionid,
        phone,
        platform: 'desktop-device-registration',
      });
      const challenge = identity().confirmVerifiedIdentity({
        challengeId: req.params.id,
        identity: login.user,
        loginEventId: login.loginEventId,
        expectedRowVersion: req.body.expectedRowVersion,
      });
      const claimant = identity().listPendingAuthorizations()
        .find(function (item) { return item.challenge.id === challenge.id; })?.claimant;
      return res.json({ success: true, data: { challenge, claimant } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/authorizations/pending', authenticated(function (_req, res, context) {
    session().assertRecentSuperAdmin(context);
    const items = identity().listPendingAuthorizations();
    return res.json({ success: true, data: { items } });
  }));

  router.post('/challenges/:id/approve', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, APPROVE_KEYS);
    session().assertRecentSuperAdmin(context, { targetDeviceId: identity().readChallenge(req.params.id).deviceId });
    const challenge = identity().approveChallenge({
      challengeId: req.params.id,
      actorContext: context,
      expectedRowVersion: req.body.expectedRowVersion,
    });
    return res.json({ success: true, data: { challenge } });
  }));

  router.post('/challenges/:id/reject', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, REJECT_KEYS);
    session().assertRecentSuperAdmin(context, { targetDeviceId: identity().readChallenge(req.params.id).deviceId });
    const challenge = identity().rejectChallenge({
      challengeId: req.params.id,
      actorContext: context,
      expectedRowVersion: req.body.expectedRowVersion,
      reason: req.body.reason,
    });
    return res.json({ success: true, data: { challenge } });
  }));

  router.post('/challenges/:id/exchange', function (req, res) {
    try {
      assertBodyKeys(req.body, EXCHANGE_KEYS);
      const exchanged = identity().exchangeChallenge({
        challengeId: req.params.id,
        challengeSecret: req.body.challengeSecret,
        signature: req.body.signature,
        expectedRowVersion: req.body.expectedRowVersion,
      });
      const issued = session().issueSession({
        userId: exchanged.authorization.userId,
        deviceId: exchanged.authorization.deviceId,
      });
      const offlineLease = createDesktopOfflineLease({
        authorization: exchanged.authorization,
        session: issued.session,
        issuedAt: typeof now === 'function' ? now() : new Date(),
      });
      const profile = createDesktopSessionProfile({
        session: issued.session,
        user: database.prepare('SELECT id, name FROM users WHERE id=?').get(
          exchanged.authorization.userId
        ),
      });
      return res.json({
        success: true,
        data: {
          authorization: exchanged.authorization,
          challenge: exchanged.challenge,
          session: issued.session,
          token: issued.token,
          offlineLease,
          profile,
        },
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/devices', authenticated(function (_req, res, context) {
    const items = identity().listDevicesForUser(context.userId);
    return res.json({ success: true, data: { items } });
  }));

  router.post('/session/challenges/start', function (req, res) {
    try {
      assertBodyKeys(req.body, SESSION_CHALLENGE_START_KEYS);
      const challenge = dailyChallenge().startChallenge(req.body);
      return res.json({ success: true, data: { challenge } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/session/challenges/:id/exchange', function (req, res) {
    try {
      assertBodyKeys(req.body, SESSION_CHALLENGE_EXCHANGE_KEYS);
      const issued = dailyChallenge().exchangeChallenge({
        challengeId: req.params.id,
        signature: req.body.signature,
        expectedRowVersion: req.body.expectedRowVersion,
      });
      return res.json({
        success: true,
        data: {
          session: issued.session,
          token: issued.token,
          offlineLease: issued.offlineLease,
          profile: issued.profile,
        },
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/session/role', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, ROLE_SWITCH_KEYS);
    const issued = session().switchActiveRole({
      actorContext: context,
      activeRole: req.body.activeRole,
      elevationIssuedAt: req.body.elevationIssuedAt,
      elevationSignature: req.body.elevationSignature,
    });
    return res.json({
      success: true,
      data: {
        session: issued.session,
        token: issued.token,
      },
    });
  }));

  router.post('/devices/:deviceId/revoke', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, REVOKE_KEYS);
    const authorization = session().revokeDeviceAuthorization({
      deviceId: req.params.deviceId,
      expectedRowVersion: req.body.expectedRowVersion,
      reason: req.body.reason,
      actorContext: context,
    });
    return res.json({ success: true, data: { authorization } });
  }));

  return router;
}

module.exports = {
  createDesktopIdentityRouter,
};
