const { Router } = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getInstance } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');
const { createDesktopIdentityService } = require('../services/desktopIdentityService');
const {
  createDesktopSessionService,
  resolveDesktopRoleContext,
} = require('../services/desktopSessionService');
const { createDeviceActivationService } = require('../services/deviceActivationService');
const { createPrimaryHostIdentityService } = require('../services/primaryHostIdentityService');
const { createPrimaryHostLocalValidationService } = require('../services/primaryHostLocalValidationService');
const {
  createDesktopDeviceChallengeService,
  createDesktopOfflineLease,
  createDesktopSessionProfile,
} = require('../services/desktopDeviceChallengeService');
const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const {
  resolveWechatIdentity: defaultResolveWechatIdentity,
  createDesktopAuthorizationQrCode: defaultCreateDesktopAuthorizationQrCode,
  createDesktopAuthorizationUrlLink: defaultCreateDesktopAuthorizationUrlLink,
} = require('../services/wechatMiniappService');

const START_KEYS = new Set(['deviceId', 'deviceName', 'deviceKind', 'publicKey', 'keyFingerprint', 'purpose']);
const CONFIRM_KEYS = new Set(['code', 'phone', 'expectedRowVersion']);
const APPROVE_KEYS = new Set(['expectedRowVersion']);
const REJECT_KEYS = new Set(['expectedRowVersion', 'reason']);
const EXCHANGE_KEYS = new Set(['challengeSecret', 'signature', 'expectedRowVersion']);
const ACTIVATION_FINALIZE_KEYS = new Set(['signature']);
const REVOKE_KEYS = new Set(['expectedRowVersion', 'reason', 'replacementDeviceId']);
const ROLE_SWITCH_KEYS = new Set([
  'activeRole',
  'elevationIssuedAt',
  'elevationSignature',
]);
const SESSION_CHALLENGE_START_KEYS = new Set(['authorizationId', 'deviceId']);
const SESSION_CHALLENGE_EXCHANGE_KEYS = new Set(['signature', 'expectedRowVersion']);
const PRIMARY_HOST_CHALLENGE_START_KEYS = new Set(['operation', 'targetDeviceId']);
const PRIMARY_HOST_CHALLENGE_CONFIRM_KEYS = new Set(['code', 'phone', 'expectedRowVersion']);
const PRIMARY_HOST_LOCAL_EVIDENCE_KEYS = new Set(['purpose', 'sourceGeneration', 'targetGeneration']);
const PRIMARY_HOST_PREFLIGHT_PROOF_KEYS = new Set([
  'operation', 'challengeId', 'transferId', 'sourceEpochId', 'sourceGeneration',
  'targetGeneration', 'operationManifest', 'localReceipt',
]);
const PRIMARY_HOST_BOOTSTRAP_KEYS = new Set([
  'challengeId', 'expectedChallengeRowVersion', 'localReceipt', 'operationManifest',
  'recoveryDeliveryKey',
]);
const PRIMARY_HOST_TRANSFER_KEYS = new Set([
  'challengeId', 'expectedChallengeRowVersion', 'expectedActiveEpochRowVersion',
]);
const PRIMARY_HOST_TRANSFER_ACTIVATE_KEYS = new Set([
  'expectedTransferRowVersion', 'localReceipt', 'validationManifest', 'preflightProof',
  'recoveryDeliveryKey',
]);
const PRIMARY_HOST_RECOVERY_KEYS = new Set([
  'challengeId', 'expectedChallengeRowVersion', 'factorId', 'recoveryCode',
  'localReceipt', 'evidence', 'preflightProof', 'recoveryDeliveryKey',
]);
const PRIMARY_HOST_RECOVERY_DELIVERY_ACK_KEYS = new Set([
  'epochId', 'factorId', 'recipientKeyFingerprint', 'expectedRowVersion',
  'acknowledgementNonce', 'acknowledgedAt', 'signature',
]);
const PRIMARY_HOST_CREDENTIAL_VERIFY_KEYS = new Set([
  'epochId', 'deviceId', 'generation', 'credential',
]);

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

function isLoopbackAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function secretsMatch(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  return expectedBuffer.length > 0
    && expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function statusForError(error, authenticationPhase = false) {
  const code = String(error?.code || 'DESKTOP_IDENTITY_FAILED');
  if (code === 'WECHAT_CONFIG_REQUIRED') return 503;
  if (code === 'DESKTOP_PAIRING_RATE_LIMITED') return 429;
  if (code.startsWith('WECHAT_') && (code.endsWith('_FAILED') || code.endsWith('_TIMEOUT'))) return 502;
  if (code === 'DESKTOP_SESSION_CHALLENGE_NOT_FOUND') return 404;
  if (code === 'PRIMARY_HOST_CHALLENGE_NOT_FOUND'
    || code === 'PRIMARY_HOST_TRANSFER_NOT_FOUND'
    || code === 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND') return 404;
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
    || code === 'PRIMARY_HOST_LOCAL_RECEIPT_LOOPBACK_REQUIRED'
    || code === 'PRIMARY_HOST_LOCAL_BRIDGE_REQUIRED'
    || code === 'PRIMARY_HOST_CANONICAL_SUPER_ADMIN_REQUIRED'
    || code === 'PRIMARY_HOST_SUPER_ADMIN_ROLE_REQUIRED'
    || code === 'PRIMARY_HOST_ACTIVE_DEVICE_REQUIRED'
    || code === 'PRIMARY_HOST_DEVICE_NOT_ACTIVE'
    || code === 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_PROOF_INVALID') return 403;
  if (code.includes('STALE')
    || code.includes('CONFLICT')
    || code.includes('ALREADY')
    || code.includes('REPLAY')
    || code.includes('STATE_INVALID')
    || code.startsWith('PRIMARY_HOST_EPOCH_')
    || code.startsWith('PRIMARY_HOST_TRANSFER_')
    || code.startsWith('PRIMARY_HOST_CHALLENGE_')
    || code === 'PRIMARY_HOST_ALREADY_BOOTSTRAPPED'
    || code === 'PRIMARY_HOST_RECOVERY_DELIVERY_PENDING'
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
  primaryHostIdentityService,
  primaryHostLocalValidationService,
  deviceChallengeService,
  miniappIdentityService,
  authenticateDesktop,
  resolveWechatIdentity = defaultResolveWechatIdentity,
  createDesktopAuthorizationQrCode = defaultCreateDesktopAuthorizationQrCode,
  createDesktopAuthorizationUrlLink = defaultCreateDesktopAuthorizationUrlLink,
  localBridgeSecret = process.env.GEWU_ELECTRON_LOCAL_BRIDGE_SECRET,
  localDeviceId = process.env.GEWU_DEVICE_ID,
  challengeIdFactory = uuidv4,
  resolveActivationAuthority,
  allowDesktopAuthorizationUrlFallback = process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'prod',
} = {}) {
  const database = db || getInstance().db;
  let identities = identityService || null;
  let sessions = sessionService || null;
  let primaryHosts = primaryHostIdentityService || null;
  let primaryHostLocalValidation = primaryHostLocalValidationService || null;
  let deviceChallenges = deviceChallengeService || null;
  let miniappIdentities = miniappIdentityService || null;
  let activations = null;
  function identity() {
    if (!identities) identities = createDesktopIdentityService({ db: database, now });
    return identities;
  }
  function session() {
    if (!sessions) sessions = createDesktopSessionService({ db: database, jwtSecret, now });
    return sessions;
  }
  function activation() {
    if (!activations) activations = createDeviceActivationService({ db: database, now });
    return activations;
  }
  function activationAuthority(authorization) {
    const resolved = typeof resolveActivationAuthority === 'function'
      ? resolveActivationAuthority(authorization)
      : database.prepare(`SELECT epoch.id AS hostEpochId, epoch.generation AS hostGeneration,
          epoch.db_authority_id AS authorityId, epoch.host_public_key AS hostPublicKey
        FROM primary_host_epochs epoch
        WHERE epoch.status='active'`).get();
    const authorityId = String(resolved?.authorityId || '').trim();
    const hostEpochId = String(resolved?.hostEpochId || '').trim();
    const hostPublicKey = String(resolved?.hostPublicKey || '').trim();
    const hostGeneration = Number(resolved?.hostGeneration);
    if (!authorityId || !hostEpochId || !hostPublicKey
      || !Number.isSafeInteger(hostGeneration) || hostGeneration < 1) {
      throw routeError('PRIMARY_HOST_EPOCH_REQUIRED_FOR_ACTIVATION');
    }
    return Object.freeze({ authorityId, hostEpochId, hostGeneration, hostPublicKey });
  }
  function activationPackage(authorization) {
    const user = database.prepare(`SELECT id,name,role,status,deleted,is_super_admin_identity,
        teacher_id,student_id
      FROM users WHERE id=? AND deleted=0`).get(authorization.userId);
    if (!user) throw routeError('DESKTOP_SESSION_USER_NOT_ACTIVE');
    const roleContext = resolveDesktopRoleContext(database, {
      user,
      authorization,
    });
    const authority = activationAuthority(authorization);
    const issuedAt = new Date(typeof now === 'function' ? now() : new Date());
    if (!Number.isFinite(issuedAt.getTime())) throw routeError('DESKTOP_ACTIVATION_CLOCK_INVALID');
    return Object.freeze({
      userId: authorization.userId,
      deviceId: authorization.deviceId,
      authorityId: authority.authorityId,
      hostEpochId: authority.hostEpochId,
      hostGeneration: authority.hostGeneration,
      hostPublicKey: authority.hostPublicKey,
      approvedBy: authorization.approvedByUserId || null,
      grant: Object.freeze({ id: uuidv4(), version: 1 }),
      lease: Object.freeze({
        id: uuidv4(),
        activeRole: roleContext.activeRole,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      authorization: Object.freeze({ ...authorization, status: 'active' }),
      profile: Object.freeze({
        userId: authorization.userId,
        user: Object.freeze({ id: authorization.userId, name: String(user.name || '').trim() }),
        eligibleRoles: roleContext.eligibleRoles,
        activeRole: roleContext.activeRole,
        teacherId: roleContext.teacherId,
        studentId: roleContext.studentId,
      }),
    });
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
  function primaryHost() {
    if (!primaryHosts) {
      primaryHosts = createPrimaryHostIdentityService({ db: database, now });
    }
    return primaryHosts;
  }
  function localHostValidation() {
    if (!primaryHostLocalValidation) {
      primaryHostLocalValidation = createPrimaryHostLocalValidationService({
        db: database,
        collectEvidence: input => primaryHost().collectLocalEvidence(input),
        backupRoot: process.env.GEWU_LOCAL_CACHE_PATH
          ? require('path').join(process.env.GEWU_LOCAL_CACHE_PATH, 'primary-host-validation')
          : undefined,
      });
    }
    return primaryHostLocalValidation;
  }
  function miniappIdentity() {
    if (!miniappIdentities) {
      miniappIdentities = createMiniappIdentityService({ db: database, jwtSecret, now });
    }
    return miniappIdentities;
  }

  async function manualMiniappIdentity({ code, phone, platform }) {
    const loginCode = String(code || '').trim();
    if (!loginCode) throw routeError('WECHAT_IDENTITY_REQUIRED');
    const wechat = await resolveWechatIdentity(loginCode);
    return miniappIdentity().loginWithClaimedWechat({
      openid: wechat.openid,
      unionid: wechat.unionid,
      phone,
      platform,
    });
  }

  function assertDesktopIdentityEligible(login, { allowVisitor = false } = {}) {
    const loginUser = login?.user || {};
    const userId = String(loginUser.id || '').trim();
    if (!userId) throw routeError('DESKTOP_IDENTITY_NOT_ELIGIBLE');
    const user = database.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!user) {
      const identityKind = String(loginUser.identity_kind || '').trim();
      const explicitVisitor = loginUser.account_state === 'visitor'
        && loginUser.role === 'visitor'
        && (!identityKind || identityKind === 'visitor');
      if (explicitVisitor && !allowVisitor) throw routeError('DESKTOP_IDENTITY_VISITOR_FORBIDDEN');
      throw routeError('DESKTOP_IDENTITY_NOT_ELIGIBLE');
    }
    if (user.deleted || user.status === 0 || user.login_enabled === 0
      || user.review_status !== 'approved') {
      throw routeError('DESKTOP_IDENTITY_NOT_ELIGIBLE');
    }
    const roleContext = resolveDesktopRoleContext(database, { user });
    if (roleContext.activeRole === 'visitor' && !allowVisitor) {
      throw routeError('DESKTOP_IDENTITY_VISITOR_FORBIDDEN');
    }
    return login;
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

  function assertLocalBridge(req) {
    const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress;
    if (!isLoopbackAddress(remoteAddress)) {
      throw routeError('PRIMARY_HOST_LOCAL_RECEIPT_LOOPBACK_REQUIRED');
    }
    if (!secretsMatch(localBridgeSecret, req.headers['x-gewu-electron-local-bridge'])) {
      throw routeError('PRIMARY_HOST_LOCAL_BRIDGE_REQUIRED');
    }
  }

  async function localBridgeBootstrapContext(req) {
    if (String(req.body?.purpose || '') === 'bootstrap') {
      const deviceId = String(localDeviceId || '').trim();
      if (!deviceId) throw routeError('PRIMARY_HOST_LOCAL_DEVICE_REQUIRED');
      // Bootstrap is deliberately bridge-authenticated rather than JWT-
      // authenticated: the host is still unadopted, so its local JWT issuer
      // is independent from the managed cloud identity issuer.  The required
      // bearer is consumed by the control plane together with the signed
      // receipt; it is never trusted as a local host JWT here.
      return Object.freeze({ deviceId, localBridgeBootstrap: true });
    }
    try {
      return await verifyDesktop(bearerToken(req));
    } catch (error) {
      throw error;
    }
  }

  function hostChallengeOrNull(challengeId) {
    try {
      return primaryHost().readOperationChallenge(challengeId);
    } catch (error) {
      if (error?.code === 'PRIMARY_HOST_CHALLENGE_NOT_FOUND') return null;
      throw error;
    }
  }

  async function createDesktopAuthorizationEntry(challengeId) {
    try {
      const qrValue = await createDesktopAuthorizationUrlLink({ challengeId });
      return { qrValue, qrImageDataUrl: null, qrEntryMode: 'url-link' };
    } catch (urlLinkError) {
      try {
        const qrImageDataUrl = await createDesktopAuthorizationQrCode({ challengeId });
        return { qrValue: null, qrImageDataUrl, qrEntryMode: 'mini-program-code' };
      } catch (qrCodeError) {
        if (allowDesktopAuthorizationUrlFallback) {
          return { qrValue: null, qrImageDataUrl: null, qrEntryMode: null };
        }
        if (!qrCodeError.cause) qrCodeError.cause = urlLinkError;
        throw qrCodeError;
      }
    }
  }

  router.post('/challenges/start', async function (req, res) {
    try {
      assertBodyKeys(req.body, START_KEYS);
      const challengeId = String(challengeIdFactory()).trim();
      const challenge = identity().startChallenge(req.body, { challengeId });
      let entry;
      try {
        entry = await createDesktopAuthorizationEntry(challenge.id);
      } catch (error) {
        identity().abandonPendingChallenge(challenge.id);
        throw error;
      }
      return res.json({ success: true, data: { challenge: { ...challenge, ...entry } } });
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
      if (hostChallengeOrNull(req.params.id)) {
        const challenge = primaryHost().readPublicOperationChallenge(req.params.id);
        return res.json({ success: true, data: { challenge } });
      }
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
      const phone = String(req.body.phone || '').trim();
      const hostChallenge = hostChallengeOrNull(req.params.id);
      if (hostChallenge) {
        if (hostChallenge.status !== 'pending_phone') {
          throw routeError('PRIMARY_HOST_CHALLENGE_STATE_INVALID');
        }
        const login = assertDesktopIdentityEligible(await manualMiniappIdentity({
          code,
          phone,
          platform: `desktop-primary-host-${hostChallenge.operation}`,
        }));
        primaryHost().confirmOperationChallenge({
          challengeId: req.params.id,
          identity: login.user,
          loginEventId: login.loginEventId,
          expectedRowVersion: req.body.expectedRowVersion,
        });
        const challenge = primaryHost().readPublicOperationChallenge(req.params.id);
        return res.json({ success: true, data: { challenge } });
      }
      const publicChallenge = identity().readMiniappChallenge(req.params.id);
      if (publicChallenge.status !== 'pending_phone') {
        throw routeError('DESKTOP_CHALLENGE_STATE_INVALID');
      }
      const login = assertDesktopIdentityEligible(
        await manualMiniappIdentity({
          code,
          phone,
          platform: publicChallenge.purpose === 'password_reset'
            ? 'desktop-password-reset'
            : 'desktop-device-registration',
        }),
        { allowVisitor: true },
      );
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
    session().assertSuperAdmin(context);
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

  router.post('/challenges/:id/activation/exchange', function (req, res) {
    try {
      assertBodyKeys(req.body, EXCHANGE_KEYS);
      const prepared = identity().beginActivation({
        challengeId: req.params.id,
        challengeSecret: req.body.challengeSecret,
        signature: req.body.signature,
        expectedRowVersion: req.body.expectedRowVersion,
      });
      if (prepared.challenge.purpose !== 'register') throw routeError('DESKTOP_ACTIVATION_PURPOSE_INVALID');
      const packageValue = activationPackage(prepared.authorization);
      const pending = activation().exchange({
        challengeId: prepared.challenge.id,
        authorizationId: prepared.authorization.id,
        activationPackage: packageValue,
      });
      return res.json({ success: true, data: { activation: pending.activation, activationPackage: pending.activationPackage } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/activations/:id/finalize', function (req, res) {
    try {
      assertBodyKeys(req.body, ACTIVATION_FINALIZE_KEYS);
      const completed = activation().finalize({ activationId: req.params.id, signature: req.body.signature });
      const authorization = completed.activationPackage.authorization;
      const issued = session().issueSession({ userId: authorization.userId, deviceId: authorization.deviceId });
      const offlineLease = createDesktopOfflineLease({
        authorization,
        session: issued.session,
        issuedAt: typeof now === 'function' ? now() : new Date(),
      });
      const profile = createDesktopSessionProfile({
        session: issued.session,
        user: database.prepare('SELECT id, name FROM users WHERE id=?').get(authorization.userId),
      });
      return res.json({
        success: true,
        data: { activation: completed.activation, authorization, session: issued.session, token: issued.token, offlineLease, profile },
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/devices', authenticated(function (_req, res, context) {
    const items = identity().listDevicesForUser(context.userId);
    return res.json({ success: true, data: { items } });
  }));

  router.get('/devices/all', authenticated(function (_req, res, context) {
    session().assertSuperAdmin(context);
    const items = identity().listAllDevices();
    return res.json({ success: true, data: { items } });
  }));

  router.get('/primary-host/status', authenticated(function (_req, res, context) {
    const data = primaryHost().getStatus(context);
    return res.json({ success: true, data });
  }));

  router.post('/primary-host/credentials/verify', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_CREDENTIAL_VERIFY_KEYS);
    const epoch = primaryHost().verifyCredentialAdoption({
      actorContext: context,
      epochId: req.body.epochId,
      deviceId: req.body.deviceId,
      generation: req.body.generation,
      credential: req.body.credential,
    });
    return res.json({ success: true, data: { epoch } });
  }));

  router.post('/primary-host/challenges/start', authenticated(async function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_CHALLENGE_START_KEYS);
    const challenge = primaryHost().startOperationChallenge({
      actorContext: context,
      operation: req.body.operation,
      targetDeviceId: req.body.targetDeviceId,
    });
    const entry = await createDesktopAuthorizationEntry(challenge.id);
    return res.json({ success: true, data: { challenge: { ...challenge, ...entry } } });
  }));

  router.get('/primary-host/challenges/:id/public', function (req, res) {
    try {
      const challenge = primaryHost().readPublicOperationChallenge(req.params.id);
      return res.json({ success: true, data: { challenge } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/primary-host/challenges/:id/confirm', async function (req, res) {
    try {
      assertBodyKeys(req.body, PRIMARY_HOST_CHALLENGE_CONFIRM_KEYS);
      const code = String(req.body.code || '').trim();
      const phone = String(req.body.phone || '').trim();
      const publicChallenge = primaryHost().readOperationChallenge(req.params.id);
      if (publicChallenge.status !== 'pending_phone') {
        throw routeError('PRIMARY_HOST_CHALLENGE_STATE_INVALID');
      }
      const login = assertDesktopIdentityEligible(await manualMiniappIdentity({
        code,
        phone,
        platform: `desktop-primary-host-${publicChallenge.operation}`,
      }));
      primaryHost().confirmOperationChallenge({
        challengeId: req.params.id,
        identity: login.user,
        loginEventId: login.loginEventId,
        expectedRowVersion: req.body.expectedRowVersion,
      });
      const challenge = primaryHost().readPublicOperationChallenge(req.params.id);
      return res.json({ success: true, data: { challenge } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/primary-host/local-evidence', async function (req, res) {
    try {
      assertBodyKeys(req.body, PRIMARY_HOST_LOCAL_EVIDENCE_KEYS);
      // A cloud token may not be locally verifiable, but the bridge still
      // requires its presence and the control plane verifies it on use.
      bearerToken(req);
      assertLocalBridge(req);
      const context = await localBridgeBootstrapContext(req);
      const prepared = await localHostValidation().prepare({
        deviceId: context.deviceId,
        operation: req.body.purpose,
        sourceGeneration: req.body.sourceGeneration,
        targetGeneration: req.body.targetGeneration,
        bootstrapCandidateVerified: context.localBridgeBootstrap === true,
        actorContext: context,
      });
      return res.json({ success: true, data: prepared });
    } catch (error) {
      return sendError(res, error, String(error?.code || '').startsWith('DESKTOP_SESSION_'));
    }
  });

  router.post('/primary-host/local-receipts', authenticated(function (_req, res) {
    return res.status(410).json({
      success: false,
      code: 'PRIMARY_HOST_LOCAL_RECEIPT_MOVED_TO_DEVICE_VAULT',
    });
  }));

  router.post('/primary-host/bootstrap', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_BOOTSTRAP_KEYS);
    const data = primaryHost().bootstrap({
      actorContext: context,
      challengeId: req.body.challengeId,
      expectedChallengeRowVersion: req.body.expectedChallengeRowVersion,
      localReceipt: req.body.localReceipt,
      operationManifest: req.body.operationManifest,
      recoveryDeliveryKey: req.body.recoveryDeliveryKey,
    });
    return res.json({ success: true, data });
  }));

  router.post('/primary-host/transfers', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_TRANSFER_KEYS);
    const transfer = primaryHost().beginTransfer({
      actorContext: context,
      challengeId: req.body.challengeId,
      expectedChallengeRowVersion: req.body.expectedChallengeRowVersion,
      expectedActiveEpochRowVersion: req.body.expectedActiveEpochRowVersion,
    });
    return res.json({ success: true, data: { transfer } });
  }));

  router.post('/primary-host/preflight-proofs', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_PREFLIGHT_PROOF_KEYS);
    const preflight = primaryHost().issuePreflightProof({
      actorContext: context,
      operation: req.body.operation,
      challengeId: req.body.challengeId,
      transferId: req.body.transferId,
      sourceEpochId: req.body.sourceEpochId,
      sourceGeneration: req.body.sourceGeneration,
      targetGeneration: req.body.targetGeneration,
      operationManifest: req.body.operationManifest,
      localReceipt: req.body.localReceipt,
    });
    return res.json({ success: true, data: { preflight } });
  }));

  router.post('/primary-host/transfers/:id/activate', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_TRANSFER_ACTIVATE_KEYS);
    const data = primaryHost().activateTransfer({
      actorContext: context,
      transferId: req.params.id,
      expectedTransferRowVersion: req.body.expectedTransferRowVersion,
      localReceipt: req.body.localReceipt,
      validationManifest: req.body.validationManifest,
      preflightProof: req.body.preflightProof,
      recoveryDeliveryKey: req.body.recoveryDeliveryKey,
    });
    return res.json({ success: true, data });
  }));

  router.post('/primary-host/recover', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_RECOVERY_KEYS);
    const data = primaryHost().recover({
      actorContext: context,
      challengeId: req.body.challengeId,
      expectedChallengeRowVersion: req.body.expectedChallengeRowVersion,
      factorId: req.body.factorId,
      recoveryCode: req.body.recoveryCode,
      localReceipt: req.body.localReceipt,
      evidence: req.body.evidence,
      preflightProof: req.body.preflightProof,
      recoveryDeliveryKey: req.body.recoveryDeliveryKey,
    });
    return res.json({ success: true, data });
  }));

  router.post('/primary-host/recovery-deliveries/:deliveryId/acknowledge', authenticated(function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_RECOVERY_DELIVERY_ACK_KEYS);
    const recoveryDelivery = primaryHost().acknowledgeRecoveryDelivery({
      actorContext: context,
      acknowledgement: {
        deliveryId: req.params.deliveryId,
        epochId: req.body.epochId,
        factorId: req.body.factorId,
        recipientKeyFingerprint: req.body.recipientKeyFingerprint,
        expectedRowVersion: req.body.expectedRowVersion,
        acknowledgementNonce: req.body.acknowledgementNonce,
        acknowledgedAt: req.body.acknowledgedAt,
      },
      signature: req.body.signature,
    });
    return res.json({ success: true, data: { recoveryDelivery } });
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
