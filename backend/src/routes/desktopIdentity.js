const { Router } = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getInstance } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');
const { createDesktopIdentityService } = require('../services/desktopIdentityService');
const { createDesktopSessionService } = require('../services/desktopSessionService');
const { createPrimaryHostIdentityService } = require('../services/primaryHostIdentityService');
const { createPrimaryHostLocalValidationService } = require('../services/primaryHostLocalValidationService');
const {
  getSingleUserDesktopIdentityService,
} = require('../services/singleUserDesktopIdentityService');
const {
  createDesktopDeviceChallengeService,
  createDesktopOfflineLease,
  createDesktopSessionProfile,
} = require('../services/desktopDeviceChallengeService');
const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const { roleContextForUser } = require('../services/userRoleGrantService');
const {
  resolveWechatIdentity: defaultResolveWechatIdentity,
  resolveWechatPhoneNumber: defaultResolveWechatPhoneNumber,
  createDesktopAuthorizationQrCode: defaultCreateDesktopAuthorizationQrCode,
  createDesktopAuthorizationUrlLink: defaultCreateDesktopAuthorizationUrlLink,
} = require('../services/wechatMiniappService');

const START_KEYS = new Set(['deviceId', 'deviceName', 'publicKey', 'keyFingerprint', 'purpose']);
const CONFIRM_KEYS = new Set(['code', 'phoneCode', 'expectedRowVersion']);
const APPROVE_KEYS = new Set(['expectedRowVersion']);
const REJECT_KEYS = new Set(['expectedRowVersion', 'reason']);
const EXCHANGE_KEYS = new Set(['challengeSecret', 'signature', 'expectedRowVersion']);
const REVOKE_KEYS = new Set(['expectedRowVersion', 'reason', 'replacementDeviceId']);
const ROLE_SWITCH_KEYS = new Set([
  'activeRole',
  'elevationIssuedAt',
  'elevationSignature',
]);
const SESSION_CHALLENGE_START_KEYS = new Set(['authorizationId', 'deviceId']);
const SESSION_CHALLENGE_EXCHANGE_KEYS = new Set(['signature', 'expectedRowVersion']);
const PRIMARY_HOST_CHALLENGE_START_KEYS = new Set(['operation', 'targetDeviceId']);
const PRIMARY_HOST_CHALLENGE_CONFIRM_KEYS = new Set(['code', 'phoneCode', 'expectedRowVersion']);
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
const SINGLE_USER_BOOTSTRAP_KEYS = new Set(['publicIdentity', 'confirmation', 'operationManifest']);
const SINGLE_USER_RESET_KEYS = new Set(['publicIdentity', 'confirmation', 'expectedCredentialVersion']);
const SINGLE_USER_GRANT_KEYS = new Set([]);
const SINGLE_USER_PAIR_KEYS = new Set([
  'protocolVersion', 'capabilityId', 'clientEphemeralPublicKey', 'iv', 'ciphertext', 'tag',
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
  singleUserIdentityService,
  deviceChallengeService,
  miniappIdentityService,
  authenticateDesktop,
  resolveWechatIdentity = defaultResolveWechatIdentity,
  resolveWechatPhoneNumber = defaultResolveWechatPhoneNumber,
  createDesktopAuthorizationQrCode = defaultCreateDesktopAuthorizationQrCode,
  createDesktopAuthorizationUrlLink = defaultCreateDesktopAuthorizationUrlLink,
  challengeIdFactory = uuidv4,
  allowDesktopAuthorizationUrlFallback = process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'prod',
  localBridgeSecret = process.env.GEWU_ELECTRON_LOCAL_BRIDGE_SECRET || '',
  desktopBuildFlavor = process.env.GEWU_DESKTOP_BUILD_FLAVOR || 'desktop-client',
  desktopIdentityMode = process.env.GEWU_DESKTOP_IDENTITY_MODE || 'full',
  runtimeContext = () => ({
    deviceId: process.env.GEWU_DEVICE_ID || '',
    nodeRole: process.env.GEWU_NODE_ROLE || 'desktop-client',
    epochId: process.env.GEWU_PRIMARY_HOST_EPOCH_ID || null,
    generation: process.env.GEWU_PRIMARY_HOST_GENERATION || null,
  }),
} = {}) {
  const database = db || getInstance().db;
  let identities = identityService || null;
  let sessions = sessionService || null;
  let primaryHosts = primaryHostIdentityService || null;
  let primaryHostLocalValidation = primaryHostLocalValidationService || null;
  let singleUserIdentities = singleUserIdentityService || null;
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
  function singleUserIdentity() {
    if (!singleUserIdentities) {
      singleUserIdentities = getSingleUserDesktopIdentityService({
        db: database,
        now,
        identityMode: () => desktopIdentityMode,
        runtimeContext,
        localValidationService: localHostValidation(),
      });
    }
    return singleUserIdentities;
  }
  function projectSingleUserPairingResult(authorized) {
    const authorizationRow = database.prepare(
      "SELECT * FROM desktop_device_authorizations WHERE id=? AND status='active'"
    ).get(authorized.authorization.id);
    const user = authorizationRow && database.prepare(
      'SELECT * FROM users WHERE id=? AND deleted=0'
    ).get(authorizationRow.user_id);
    if (!authorizationRow || !user) {
      const error = new Error('DESKTOP_PAIRING_AUTHORIZATION_PROJECTION_FAILED');
      error.code = 'DESKTOP_PAIRING_AUTHORIZATION_PROJECTION_FAILED';
      throw error;
    }
    const roleContext = roleContextForUser(database, user.id);
    const projection = {
      id: `desktop-pairing:${authorized.requestId}`,
      userId: user.id,
      deviceId: authorizationRow.device_id,
      activeRole: roleContext.activeRole,
      eligibleRoles: roleContext.eligibleRoles,
      teacherId: roleContext.teacherId,
      studentId: roleContext.studentId,
    };
    return Object.freeze({
      authorization: authorized.authorization,
      profile: createDesktopSessionProfile({ session: projection, user }),
      offlineLease: createDesktopOfflineLease({
        authorization: authorizationRow,
        session: projection,
        issuedAt: typeof now === 'function' ? now() : new Date(),
        leaseId: `desktop-pairing-offline:${authorized.requestId}`,
      }),
      authorizationSummary: Object.freeze({
        id: authorized.authorization.id,
        deviceId: authorized.authorization.deviceId,
        credentialVersion: authorized.authorization.credentialVersion,
      }),
    });
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

  function isLoopbackRequest(req) {
    const address = String(req.socket?.remoteAddress || req.ip || '').toLowerCase();
    return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
  }

  function assertLocalBridge(req) {
    if (!isLoopbackRequest(req)) throw routeError('PRIMARY_HOST_LOCAL_BRIDGE_FORBIDDEN');
    const expected = Buffer.from(String(localBridgeSecret || ''), 'utf8');
    const supplied = Buffer.from(String(req.get('x-gewu-electron-local-bridge') || ''), 'utf8');
    if (expected.length < 32 || expected.length !== supplied.length
      || !crypto.timingSafeEqual(expected, supplied)) {
      throw routeError('PRIMARY_HOST_LOCAL_BRIDGE_FORBIDDEN');
    }
  }

  function assertSingleUserHostRuntime(req, { allowBootstrapCandidate = false } = {}) {
    assertLocalBridge(req);
    const runtime = runtimeContext() || {};
    if (desktopBuildFlavor !== 'primary-host' || desktopIdentityMode !== 'single-user') {
      throw routeError('DESKTOP_SINGLE_USER_HOST_RUNTIME_FORBIDDEN');
    }
    if (runtime.nodeRole === 'primary-host') return runtime;
    const activeEpoch = allowBootstrapCandidate && database.prepare(
      "SELECT device_id FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1"
    ).get();
    const isBootstrapCandidate = allowBootstrapCandidate
      && runtime.nodeRole === 'desktop-client'
      && !runtime.epochId && !runtime.generation
      && (!activeEpoch || activeEpoch.device_id === runtime.deviceId);
    if (!isBootstrapCandidate) throw routeError('DESKTOP_SINGLE_USER_HOST_RUNTIME_FORBIDDEN');
    return runtime;
  }

  function localHostActor() {
    const epoch = database.prepare(
      "SELECT * FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1"
    ).get();
    const authorization = epoch && database.prepare(
      'SELECT * FROM desktop_device_authorizations WHERE id=? AND status=\'active\''
    ).get(epoch.authorization_id);
    if (!epoch || !authorization) throw routeError('DESKTOP_SINGLE_USER_HOST_NOT_BOOTSTRAPPED');
    return Object.freeze({
      userId: epoch.user_id,
      deviceId: epoch.device_id,
      authorizationId: epoch.authorization_id,
      credentialVersion: Number(authorization.credential_version),
      activeRole: 'super_admin',
      eligibleRoles: Object.freeze(['super_admin']),
      epochId: epoch.id,
      generation: Number(epoch.generation),
    });
  }

  const pairingRateBuckets = new Map();
  function assertPairingRate(req, bucket, limit, windowMs) {
    const current = Date.now();
    const key = `${bucket}:${String(req.ip || req.socket?.remoteAddress || 'unknown')}`;
    const previous = pairingRateBuckets.get(key);
    const state = !previous || current - previous.startedAt >= windowMs
      ? { startedAt: current, count: 0 }
      : previous;
    state.count += 1;
    pairingRateBuckets.set(key, state);
    if (state.count > limit) throw routeError('DESKTOP_PAIRING_RATE_LIMITED');
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

  router.post('/single-user/bootstrap', async function (req, res) {
    try {
      assertBodyKeys(req.body, SINGLE_USER_BOOTSTRAP_KEYS);
      const runtime = assertSingleUserHostRuntime(req, { allowBootstrapCandidate: true });
      const result = await singleUserIdentity().bootstrapLocalHost({
        localBridgeVerified: true,
        bootstrapCandidateVerified: true,
        buildFlavor: desktopBuildFlavor,
        runtime,
        publicIdentity: req.body.publicIdentity,
        confirmation: req.body.confirmation,
        operationManifest: req.body.operationManifest,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/single-user/status', function (req, res) {
    try {
      const runtime = assertSingleUserHostRuntime(req);
      const epoch = database.prepare(
        "SELECT id,generation,device_id,user_id,status FROM primary_host_epochs WHERE status='active' LIMIT 1"
      ).get() || null;
      return res.json({
        success: true,
        mode: desktopIdentityMode,
        buildFlavor: desktopBuildFlavor,
        runtime,
        epoch,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/single-user/reset-host-password', function (req, res) {
    try {
      assertBodyKeys(req.body, SINGLE_USER_RESET_KEYS);
      const runtime = assertSingleUserHostRuntime(req);
      const result = singleUserIdentity().resetLocalHostCredential({
        actor: localHostActor(),
        runtime,
        publicIdentity: req.body.publicIdentity,
        confirmation: req.body.confirmation,
        expectedCredentialVersion: req.body.expectedCredentialVersion,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/single-user/grants', function (req, res) {
    try {
      assertBodyKeys(req.body, SINGLE_USER_GRANT_KEYS);
      const runtime = assertSingleUserHostRuntime(req);
      const result = singleUserIdentity().issuePairingGrant({ actor: localHostActor(), runtime });
      return res.json({ success: true, grant: result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/single-user/grants/:grantId/revoke', function (req, res) {
    try {
      assertBodyKeys(req.body, SINGLE_USER_GRANT_KEYS);
      const runtime = assertSingleUserHostRuntime(req);
      const result = singleUserIdentity().revokePairingGrant({
        actor: localHostActor(),
        runtime,
        grantId: req.params.grantId,
      });
      return res.json({ success: true, grant: result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/single-user/disable', function (req, res) {
    try {
      assertBodyKeys(req.body, SINGLE_USER_GRANT_KEYS);
      const runtime = assertSingleUserHostRuntime(req);
      const result = singleUserIdentity().disableSingleUserAuthorizations({
        actor: localHostActor(),
        runtime,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/single-user/pairing-capability', function (req, res) {
    try {
      assertPairingRate(req, 'capability', 120, 60 * 1000);
      const capability = singleUserIdentity().currentPairingCapability();
      return res.json({ success: true, capability });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/single-user/pairing-requests', function (req, res) {
    try {
      assertBodyKeys(req.body, SINGLE_USER_PAIR_KEYS);
      assertPairingRate(req, 'request', 20, 10 * 60 * 1000);
      const authorized = singleUserIdentity().consumeEncryptedPairingRequest({
        envelope: req.body,
        channel: 'direct',
      });
      const result = projectSingleUserPairingResult(authorized);
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

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
      const phoneCode = String(req.body.phoneCode || '').trim();
      if (!code || !phoneCode) throw routeError('VERIFIED_WECHAT_IDENTITY_REQUIRED');
      const hostChallenge = hostChallengeOrNull(req.params.id);
      if (hostChallenge) {
        if (hostChallenge.status !== 'pending_phone') {
          throw routeError('PRIMARY_HOST_CHALLENGE_STATE_INVALID');
        }
        const wechat = await resolveWechatIdentity(code);
        const phone = await resolveWechatPhoneNumber(phoneCode);
        const login = miniappIdentity().loginWithVerifiedWechat({
          openid: wechat.openid,
          unionid: wechat.unionid,
          phone,
          platform: `desktop-primary-host-${hostChallenge.operation}`,
        });
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
      const wechat = await resolveWechatIdentity(code);
      const phone = await resolveWechatPhoneNumber(phoneCode);
      const login = miniappIdentity().loginWithVerifiedWechat({
        openid: wechat.openid,
        unionid: wechat.unionid,
        phone,
        platform: publicChallenge.purpose === 'password_reset'
          ? 'desktop-password-reset'
          : 'desktop-device-registration',
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
      const phoneCode = String(req.body.phoneCode || '').trim();
      if (!code || !phoneCode) throw routeError('VERIFIED_WECHAT_IDENTITY_REQUIRED');
      const publicChallenge = primaryHost().readOperationChallenge(req.params.id);
      if (publicChallenge.status !== 'pending_phone') {
        throw routeError('PRIMARY_HOST_CHALLENGE_STATE_INVALID');
      }
      const wechat = await resolveWechatIdentity(code);
      const phone = await resolveWechatPhoneNumber(phoneCode);
      const login = miniappIdentity().loginWithVerifiedWechat({
        openid: wechat.openid,
        unionid: wechat.unionid,
        phone,
        platform: `desktop-primary-host-${publicChallenge.operation}`,
      });
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

  router.post('/primary-host/local-evidence', authenticated(async function (req, res, context) {
    assertBodyKeys(req.body, PRIMARY_HOST_LOCAL_EVIDENCE_KEYS);
    assertLocalBridge(req);
    const prepared = await localHostValidation().prepare({
      deviceId: context.deviceId,
      operation: req.body.purpose,
      sourceGeneration: req.body.sourceGeneration,
      targetGeneration: req.body.targetGeneration,
      actorContext: context,
    });
    return res.json({ success: true, data: prepared });
  }));

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
