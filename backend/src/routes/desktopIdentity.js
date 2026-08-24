const { Router } = require('express');
const { getInstance } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');
const { createDesktopIdentityService } = require('../services/desktopIdentityService');
const { createDesktopSessionService } = require('../services/desktopSessionService');
const {
  createDesktopDeviceChallengeService,
  createDesktopOfflineLease,
  createDesktopSessionProfile,
} = require('../services/desktopDeviceChallengeService');
const REVOKE_KEYS = new Set(['expectedRowVersion', 'reason', 'replacementDeviceId']);
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
  if (code === 'DESKTOP_PAIRING_RATE_LIMITED') return 429;
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
    || code === 'DESKTOP_IDENTITY_NOT_ELIGIBLE'
    ) return 403;
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
  authenticateDesktop,
} = {}) {
  const database = db || getInstance().db;
  let identities = identityService || null;
  let sessions = sessionService || null;
  let deviceChallenges = deviceChallengeService || null;
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

  router.get('/devices', authenticated(function (_req, res, context) {
    const items = identity().listDevicesForUser(context.userId);
    return res.json({ success: true, data: { items } });
  }));

  router.get('/devices/all', authenticated(function (_req, res, context) {
    session().assertSuperAdmin(context);
    const items = identity().listAllDevices();
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
      replacementDeviceId: req.body.replacementDeviceId,
      actorContext: context,
    });
    return res.json({ success: true, data: { authorization } });
  }));

  return router;
}

module.exports = {
  createDesktopIdentityRouter,
};
