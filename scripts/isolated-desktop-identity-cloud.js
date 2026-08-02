'use strict';

// Disposable identity plane for real packaged-Electron UI verification only.
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(process.argv[2] || '');
const port = Number(process.argv[3] || 0);
const ISOLATED_JSON_BODY_LIMIT = '50mb';
if (!path.basename(root).startsWith('tmp-real-desktop-identity-cloud-') || !Number.isSafeInteger(port)) {
  throw new Error('ISOLATED_IDENTITY_CLOUD_ARGUMENTS_REQUIRED');
}
fs.mkdirSync(root, { recursive: true });
process.env.DB_PATH = path.join(root, 'identity-cloud.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'dev';
process.env.WECHAT_USE_MOCK_LOGIN = 'true';
process.env.ALLOW_DEV_WECHAT_LOGIN = 'true';
process.env.WECHAT_DEV_OPENID = process.env.WECHAT_DEV_OPENID || 'isolated-miniapp-visitor';
const jwtSecret = 'isolated-desktop-identity-cloud-test-secret';
// Authentication modules capture this value when they are required, so the
// disposable secret must be installed before loading any backend route.
process.env.JWT_SECRET = jwtSecret;
const { DatabaseService } = require('../backend/src/database');
const { createDesktopIdentityService } = require('../backend/src/services/desktopIdentityService');
const { createDesktopSessionService } = require('../backend/src/services/desktopSessionService');
const { createMiniappIdentityService } = require('../backend/src/services/miniappIdentityService');
const { createPrimaryHostIdentityService } = require('../backend/src/services/primaryHostIdentityService');
const { createDesktopIdentityRouter } = require('../backend/src/routes/desktopIdentity');
const taskService = require('../backend/src/services/cloudRelayTaskService');
const { createAuthorityProtocolRouter } = require('../backend/src/routes/authorityProtocol');
const { CloudRelaySocketServer } = require('../backend/src/websocket/cloudRelayServer');
const database = new DatabaseService().db;
const E2E_BOOTSTRAP_AUTHORITY_ID = 'isolated-two-desktop-acceptance';
const E2E_BOOTSTRAP_ADMIN_ID = 'miniapp-admin-13732250653';
function ensureE2eBootstrapAuthority(db) {
  const admin = db.prepare(`SELECT id FROM users
    WHERE id=? AND status=1 AND login_enabled=1 AND deleted=0`).get(E2E_BOOTSTRAP_ADMIN_ID);
  if (!admin) throw new Error('E2E_BOOTSTRAP_ADMIN_REQUIRED');
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
      VALUES(?,?,'active',?,?)
      ON CONFLICT(user_id) DO UPDATE SET authority_id=excluded.authority_id,
        status='active',updated_at=excluded.updated_at`)
      .run(admin.id, E2E_BOOTSTRAP_AUTHORITY_ID, now, now);
    db.prepare(`INSERT INTO authority_role_bindings
      (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
       granted_by,created_at,updated_at,revoked_at)
      VALUES('isolated-bootstrap-super-admin-binding',?,?,'super_admin',NULL,NULL,
        'active',1,?,?,?,NULL)
      ON CONFLICT(binding_id) DO UPDATE SET authority_id=excluded.authority_id,
        user_id=excluded.user_id,role='super_admin',subject_type=NULL,subject_id=NULL,
        status='active',grant_version=excluded.grant_version,granted_by=excluded.granted_by,
        updated_at=excluded.updated_at,revoked_at=NULL`)
      .run(E2E_BOOTSTRAP_AUTHORITY_ID, admin.id, admin.id, now, now);
  })();
}
ensureE2eBootstrapAuthority(database);
function ensureGatewayAuthorityMirrorTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS authority_role_mirror_versions (
    authority_id TEXT PRIMARY KEY, host_epoch_id TEXT NOT NULL,
    source_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
    projection_signature TEXT NOT NULL, generated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS role_application_mirrors (
    authority_id TEXT NOT NULL, application_id TEXT NOT NULL,
    host_epoch_id TEXT NOT NULL, source_version INTEGER NOT NULL,
    user_id TEXT NOT NULL, requested_role TEXT NOT NULL, status TEXT NOT NULL,
    payload_json TEXT NOT NULL, projection_signature TEXT NOT NULL, generated_at TEXT NOT NULL,
    PRIMARY KEY (authority_id, application_id)
  );
  CREATE TABLE IF NOT EXISTS role_grant_mirrors (
    authority_id TEXT NOT NULL, binding_id TEXT NOT NULL,
    host_epoch_id TEXT NOT NULL, source_version INTEGER NOT NULL,
    user_id TEXT NOT NULL, role TEXT NOT NULL, grant_version INTEGER NOT NULL, status TEXT NOT NULL,
    payload_json TEXT NOT NULL, projection_signature TEXT NOT NULL, generated_at TEXT NOT NULL,
    PRIMARY KEY (authority_id, binding_id)
  );
  CREATE TABLE IF NOT EXISTS authority_device_control_mirror_versions (
    authority_id TEXT PRIMARY KEY, host_epoch_id TEXT NOT NULL,
    host_generation INTEGER NOT NULL, source_version INTEGER NOT NULL,
    snapshot_hash TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
}
ensureGatewayAuthorityMirrorTables(database);
// The formal cloud-relay WebSocket server verifies desktop session tokens with
// this process-level value. This is only the disposable isolated plane.
const identity = createDesktopIdentityService({ db: database });
const sessions = createDesktopSessionService({ db: database, jwtSecret });
const miniapp = createMiniappIdentityService({ db: database, jwtSecret });
const primaryHost = createPrimaryHostIdentityService({ db: database });
const authRouter = require('../backend/src/routes/auth');
const { authMiddleware } = require('../backend/src/middleware/auth');
const permissionsRouter = require('../backend/src/routes/permissions');
const modulesRouter = require('../backend/src/routes/modules');
const {
  createAuthorityProjectionStoreService,
} = require('../backend/src/services/authorityProjectionStoreService');
const {
  createMiniappAuthorityProjectionHandler,
} = require('../backend/src/routes/miniappAuthorityProjection');
const {
  createMiniappAuthorityApplicationsRouter,
} = require('../backend/src/routes/miniappAuthorityApplications');
const {
  createAuthorityCommandInboxService,
} = require('../backend/src/services/authorityCommandInboxService');
const {
  createAuthorityCommandAuthorizationService,
} = require('../backend/src/services/authorityCommandAuthorizationService');
const {
  createAuthorityCommandPolicy,
} = require('../backend/src/services/authorityCommandRegistry');
const {
  createAuthorityDeviceRequestAuth,
} = require('../backend/src/services/authorityDeviceRequestAuth');
const {
  createAuthorityCloudControlService,
} = require('../backend/src/services/authorityCloudControlService');
const miniappCommandInbox = createAuthorityCommandInboxService({
  db: database,
  targetHostIdFor: envelope => {
    const epoch = database.prepare(`SELECT device_id,db_authority_id FROM primary_host_epochs
      WHERE id=? AND status='active'`).get(envelope.hostEpochId);
    if (!epoch || epoch.db_authority_id !== envelope.authorityId) {
      throw Object.assign(new Error('AUTHORITY_HOST_EPOCH_INACTIVE'), {
        code: 'AUTHORITY_HOST_EPOCH_INACTIVE', statusCode: 403,
      });
    }
    return epoch.device_id;
  },
});
const miniappCommandAuthorization = createAuthorityCommandAuthorizationService({
  db: database,
  commandPolicy: createAuthorityCommandPolicy(),
});
const authorityDeviceRequestAuth = createAuthorityDeviceRequestAuth({ db: database });
const cloudControls = createAuthorityCloudControlService({ db: database });
const authorityProjectionStore = createAuthorityProjectionStoreService({ db: database });
const e2eWechatIdentity = {
  openid: 'isolated-desktop-confirmation-user',
  phone: '13732250653',
};
function currentE2eWechatIdentity() {
  const existing = database.prepare('SELECT wechat_openid FROM users WHERE phone_normalized=? LIMIT 1')
    .get(e2eWechatIdentity.phone);
  return {
    ...e2eWechatIdentity,
    openid: existing?.wechat_openid || e2eWechatIdentity.openid,
  };
}

function taskRouteError(res, error) {
  return res.status(Number(error.statusCode) || 500).json({
    success: false,
    code: error.code || 'E2E_RELAY_OPERATION_FAILED',
    error: error.message,
  });
}

function hostDeviceId(req) {
  return String(req.headers['x-gewu-host-device-id'] || '').trim();
}

function requireTestHost(req, res, next) {
  if (!hostDeviceId(req)
    || !String(req.headers['x-gewu-host-generation'] || '').trim()
    || !String(req.headers['x-gewu-host-credential'] || '').trim()) {
    return res.status(401).json({ success: false, code: 'E2E_HOST_CREDENTIAL_REQUIRED' });
  }
  return next();
}

function requireDesktopActor(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  try {
    const actor = sessions.verifySessionToken(token);
    const headerDeviceId = String(req.headers['x-device-id'] || '').trim();
    if (!actor?.userId || !actor?.deviceId || !actor?.authorizationId
      || (headerDeviceId && headerDeviceId !== actor.deviceId)) {
      throw Object.assign(new Error('desktop session does not own the requested device'), {
        code: 'ONLINE_DESKTOP_SESSION_REQUIRED', statusCode: 401,
      });
    }
    req.desktopActor = actor;
    return next();
  } catch (error) {
    return taskRouteError(res, Object.assign(error, { statusCode: error.statusCode || 401 }));
  }
}

const app = express();
let latestBootstrapAttempt = null;
let latestCredentialVerification = null;
app.use((_req, res, next) => {
  // Packaged Electron renders the UI from a file origin. The disposable
  // control plane must model the production identity CORS contract so the
  // browser can read successful registration responses instead of creating a
  // server-side pending challenge and showing a generic client error.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', [
    'Content-Type', 'Authorization', 'X-Device-Id',
    'X-Gewu-Authority-User-Id', 'X-Gewu-Authority-Device-Id',
    'X-Gewu-Authority-Role', 'X-Gewu-Device-Signature',
    'X-Gewu-Authority-Id', 'X-Gewu-Authority-Lease-Id',
    'X-Gewu-Authority-Grant-Version', 'X-Gewu-Host-Device-Id',
    'X-Gewu-Host-Generation', 'X-Gewu-Host-Credential',
  ].join(', '));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});
app.options('/{*splat}', (_req, res) => res.status(204).end());
app.use(express.json({ limit: ISOLATED_JSON_BODY_LIMIT }));
app.use((req, res, next) => {
  if (!String(req.path || '').startsWith('/api/authority/')) return next();
  res.once('finish', () => {
    console.log(JSON.stringify({
      e2eAuthorityHttp: true,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      actorDeviceId: String(req.headers['x-gewu-authority-device-id'] || ''),
    }));
  });
  return next();
});
app.use('/api/desktop-identity/primary-host/bootstrap', (req, _res, next) => {
  const stage = req.body?.operationManifest?.credentialStage || {};
  latestBootstrapAttempt = {
    hasChallengeId: Boolean(req.body?.challengeId),
    stage: {
      hasId: Boolean(String(stage.id || '').trim()),
      hasDeviceId: Boolean(String(stage.deviceId || '').trim()),
      targetGeneration: Number(stage.targetGeneration || 0),
      hasCommitment: /^[a-f0-9]{64}$/i.test(String(stage.commitment || '')),
    },
    hasRecoveryDeliveryKey: Boolean(req.body?.recoveryDeliveryKey?.publicKeyPem),
  };
  next();
});
app.use('/api/desktop-identity/primary-host/credentials/verify', (req, _res, next) => {
  const authorization = String(req.headers.authorization || '');
  latestCredentialVerification = {
    hasAuthorization: Boolean(authorization),
    authorizationFingerprint: authorization
      ? require('crypto').createHash('sha256').update(authorization).digest('hex').slice(0, 16)
      : null,
    hasEpochId: Boolean(String(req.body?.epochId || '').trim()),
    hasCredential: Boolean(String(req.body?.credential || '').trim()),
  };
  next();
});
app.use('/api/desktop-identity', createDesktopIdentityRouter({
  db: database,
  jwtSecret,
  identityService: identity,
  sessionService: sessions,
  miniappIdentityService: miniapp,
  resolveWechatIdentity: async () => ({ openid: e2eWechatIdentity.openid, unionid: null }),
  resolveWechatPhoneNumber: async () => e2eWechatIdentity.phone,
  createDesktopAuthorizationUrlLink: async ({ challengeId }) => `http://127.0.0.1:${port}/miniapp/${challengeId}`,
  createDesktopAuthorizationQrCode: async ({ challengeId }) => `data:image/png;base64,${Buffer.from(challengeId).toString('base64')}`,
}));
app.use('/api/auth', authRouter);
app.use('/api/permissions', authMiddleware, permissionsRouter);
app.use('/api/modules', authMiddleware, modulesRouter);
app.get('/api/miniapp/projection', authMiddleware, createMiniappAuthorityProjectionHandler({
  db: database,
  projectionStore: authorityProjectionStore,
}));
function notifyAuthorityHost({ envelope, queued, request }) {
  const epoch = database.prepare(`SELECT device_id FROM primary_host_epochs
    WHERE id=? AND status='active'`).get(envelope.hostEpochId);
  if (epoch?.device_id) {
    request.app?.get('cloudRelaySocketServer')?.notifyHostNewTask(epoch.device_id, {
      id: queued.id,
      task_type: 'authority-command-v1',
    });
  }
}
app.use('/api/miniapp/applications', authMiddleware, createMiniappAuthorityApplicationsRouter({
  db: database,
  commandInbox: miniappCommandInbox,
  commandAuthorization: miniappCommandAuthorization,
  onCommandQueued: notifyAuthorityHost,
}));
function authorityHost(req) {
  const epoch = primaryHost.assertActiveHostCredential({
    deviceId: req.headers['x-gewu-host-device-id'],
    generation: req.headers['x-gewu-host-generation'],
    credential: req.headers['x-gewu-host-credential'],
  });
  return Object.freeze({
    id: epoch.id,
    dbAuthorityId: epoch.dbAuthorityId,
    deviceId: epoch.deviceId,
    generation: Number(epoch.generation),
  });
}
function authorityFailure(res, error, fallback) {
  return res.status(error?.statusCode || 400).json({
    success: false,
    error: { code: error?.code || fallback },
  });
}
app.post('/api/authority/host/epoch', (req, res) => {
  try {
    return res.json({ success: true, epoch: cloudControls.publishEpoch({
      host: authorityHost(req), epoch: req.body?.epoch,
    }) });
  } catch (error) { return authorityFailure(res, error, 'AUTHORITY_HOST_EPOCH_MIRROR_FAILED'); }
});
app.get('/api/authority/host/epoch', (req, res) => {
  try {
    return res.json({ success: true, epoch: cloudControls.readEpoch({ host: authorityHost(req) }) });
  } catch (error) { return authorityFailure(res, error, 'AUTHORITY_HOST_EPOCH_READ_FAILED'); }
});
app.post('/api/authority/host/control-records', (req, res) => {
  try {
    return res.json({ success: true, result: cloudControls.publishControlRecords({
      host: authorityHost(req), snapshot: req.body?.snapshot,
    }) });
  } catch (error) { return authorityFailure(res, error, 'AUTHORITY_DEVICE_CONTROL_MIRROR_FAILED'); }
});
app.get('/api/authority/host/control-records', (req, res) => {
  try {
    return res.json({ success: true, snapshot: cloudControls.readControlRecords({ host: authorityHost(req) }) });
  } catch (error) { return authorityFailure(res, error, 'AUTHORITY_DEVICE_CONTROL_MIRROR_READ_FAILED'); }
});
app.post('/api/authority/host/projections', (req, res) => {
  try {
    return res.json({ success: true, projection: cloudControls.publishProjection({
      host: authorityHost(req), projection: req.body?.projection,
    }) });
  } catch (error) { return authorityFailure(res, error, 'AUTHORITY_PROJECTION_PUBLISH_FAILED'); }
});
const authorityApiRouter = express.Router();
const authenticateAuthorityDevice = (req, res, next) => {
  try {
    req.authorityActor = authorityDeviceRequestAuth.authenticate(req);
    return next();
  } catch (error) {
    return res.status(error?.statusCode || 401).json({
      success: false,
      error: { code: error?.code || 'AUTHORITY_DEVICE_AUTH_FAILED' },
    });
  }
};
authorityApiRouter.post('/commands', authenticateAuthorityDevice);
authorityApiRouter.get('/commands/:id/receipt', authenticateAuthorityDevice);
authorityApiRouter.use(createAuthorityProtocolRouter({
  authorizeCommand: ({ envelope }) => miniappCommandAuthorization.authorize(envelope),
  enqueueCommand: envelope => miniappCommandInbox.enqueue(envelope),
  findReceipt: input => miniappCommandInbox.findReceipt(input),
  authorizeHostRequest: req => authorityHost(req),
  claimCommands: input => miniappCommandInbox.claim(input),
  renewCommandClaim: input => miniappCommandInbox.renew(input),
  publishHostReceipt: (receipt, claim) => miniappCommandInbox.publishReceipt(receipt, claim),
  onCommandQueued: notifyAuthorityHost,
}));
// The isolated control plane uses the same backend authority router, inbox and
// socket instance. It intentionally has no desktop-session relay compatibility path.
app.use('/api/authority', authorityApiRouter);
app.post('/api/cloud/host/heartbeat', requireTestHost, (req, res) => {
  const deviceId = hostDeviceId(req);
  const time = new Date().toISOString();
  database.prepare(`INSERT INTO host_heartbeats
    (id, host_device_id, status, base_url, lan_urls, capabilities, last_snapshot_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, base_url=excluded.base_url,
      lan_urls=excluded.lan_urls, capabilities=excluded.capabilities,
      last_snapshot_at=excluded.last_snapshot_at, updated_at=excluded.updated_at`)
    .run(deviceId, deviceId, req.body.status || 'online', req.body.baseUrl || '',
      JSON.stringify(req.body.lanUrls || req.body.lan_urls || []),
      JSON.stringify(req.body.capabilities || []), req.body.lastSnapshotAt || null, time, time);
  return res.json({ success: true, serverTime: time });
});
app.get('/api/cloud/host/status', requireDesktopActor, (_req, res) => {
  const host = database.prepare("SELECT * FROM host_heartbeats WHERE status='online' ORDER BY updated_at DESC LIMIT 1").get() || null;
  return res.json({ success: true, online: Boolean(host), host, serverTime: new Date().toISOString() });
});
app.post('/api/cloud/tasks/claim', requireTestHost, (req, res) => {
  try {
    const claimed = taskService.claimNextV2Task(database, {
      hostDeviceId: req.body.hostDeviceId || req.body.host_device_id || hostDeviceId(req),
      leaseMs: req.body.leaseMs || req.body.lease_ms,
    });
    return res.json({ success: true, task: claimed?.task || null, claimToken: claimed?.claimToken || null });
  } catch (error) { return taskRouteError(res, error); }
});
app.post('/api/cloud/tasks/:id/progress', requireTestHost, (req, res) => {
  try {
    return res.json({ success: true, task: taskService.updateV2TaskProgress(database, req.params.id, req.body || {}) });
  } catch (error) { return taskRouteError(res, error); }
});
app.post('/api/cloud/tasks/:id/complete', requireTestHost, (req, res) => {
  try {
    return res.json({ success: true, task: taskService.completeV2Task(database, req.params.id, req.body || {}) });
  } catch (error) { return taskRouteError(res, error); }
});
app.post('/api/cloud/tasks/:id/fail', requireTestHost, (req, res) => {
  try {
    return res.json({ success: true, task: taskService.failV2Task(database, req.params.id, req.body || {}) });
  } catch (error) { return taskRouteError(res, error); }
});
app.get('/api/cloud/tasks/:id/state', requireTestHost, (req, res) => {
  const requestedHost = String(req.query.hostDeviceId || req.query.host_device_id || hostDeviceId(req)).trim();
  const task = database.prepare(`SELECT * FROM miniapp_tasks WHERE id=?
    AND (target_host_device_id=? OR claimed_by=?)`).get(req.params.id, requestedHost, requestedHost);
  if (!task) return res.status(404).json({ success: false, code: 'TASK_NOT_FOUND' });
  return res.json({ success: true, task: taskService.taskRow(task) });
});
app.post('/__e2e/confirm-latest', (_req, res) => {
  const row = database.prepare("SELECT id,row_version FROM desktop_identity_challenges WHERE status='pending_phone' ORDER BY created_at DESC LIMIT 1").get();
  if (!row) return res.status(404).json({ success: false, code: 'E2E_PENDING_CHALLENGE_REQUIRED' });
  const verifiedIdentity = currentE2eWechatIdentity();
  const login = miniapp.loginWithVerifiedWechat({
    openid: verifiedIdentity.openid,
    phone: verifiedIdentity.phone,
    platform: 'isolated-desktop-e2e',
  });
  const challenge = identity.confirmVerifiedIdentity({ challengeId: row.id, identity: login.user, loginEventId: login.loginEventId, expectedRowVersion: row.row_version });
  return res.json({ success: true, data: { challengeId: challenge.id, status: challenge.status } });
});
app.post('/__e2e/approve-latest-bootstrap-host', (_req, res) => {
  const row = database.prepare("SELECT id,row_version FROM desktop_identity_challenges WHERE status='identity_verified_pending_approval' ORDER BY created_at DESC LIMIT 1").get();
  if (!row) return res.status(404).json({ success: false, code: 'E2E_APPROVABLE_CHALLENGE_REQUIRED' });
  const challenge = identity.approveChallenge({
    challengeId: row.id,
    expectedRowVersion: row.row_version,
    actorContext: {
      userId: 'miniapp-admin-13732250653', deviceId: 'isolated-bootstrap-control',
      activeRole: 'super_admin', eligibleRoles: ['super_admin'],
      authTime: new Date().toISOString(), scope: { kind: 'all' },
    },
  });
  return res.json({ success: true, data: { challengeId: challenge.id, status: challenge.status } });
});
app.post('/__e2e/confirm-latest-primary-host', (_req, res) => {
  const row = database.prepare(`SELECT id, row_version FROM primary_host_operation_challenges
    WHERE status='pending_phone' ORDER BY created_at DESC LIMIT 1`).get();
  if (!row) return res.status(404).json({ success: false, code: 'E2E_PENDING_PRIMARY_HOST_CHALLENGE_REQUIRED' });
  const verifiedIdentity = currentE2eWechatIdentity();
  const login = miniapp.loginWithVerifiedWechat({
    openid: verifiedIdentity.openid,
    phone: verifiedIdentity.phone,
    platform: 'isolated-primary-host-e2e',
  });
  const challenge = primaryHost.confirmOperationChallenge({
    challengeId: row.id,
    identity: login.user,
    loginEventId: login.loginEventId,
    expectedRowVersion: row.row_version,
  });
  return res.json({ success: true, data: { challengeId: challenge.id, status: challenge.status } });
});
app.post('/__e2e/reset-credential-verification-trace', (_req, res) => {
  latestCredentialVerification = null;
  return res.json({ success: true });
});
app.post('/__e2e/seed-authority', (req, res) => {
  const {
    authorityId, hostEpochId, hostDeviceId, hostCredentialHash, hostPublicKey,
  } = req.body || {};
  if (authorityId !== E2E_BOOTSTRAP_AUTHORITY_ID
      || hostEpochId !== 'isolated-host-epoch-1'
      || hostDeviceId !== 'isolated-host-device-1'
      || !/^[a-f0-9]{64}$/.test(String(hostCredentialHash || ''))
      || !String(hostPublicKey || '').startsWith('-----BEGIN PUBLIC KEY-----')) {
    return res.status(400).json({ success: false, code: 'E2E_AUTHORITY_FIXTURE_INVALID' });
  }
  const now = '2026-08-02T00:00:00.000Z';
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
    database.prepare(`UPDATE users SET role='super_admin',identity_kind='admin',status=1,
      login_enabled=1,review_status='approved',is_super_admin_identity=1,deleted=0,updated_at=?
      WHERE id=?`).run(now, E2E_BOOTSTRAP_ADMIN_ID);
    database.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
      VALUES(?,?,'active',?,?)
      ON CONFLICT(user_id) DO UPDATE SET authority_id=excluded.authority_id,
        status='active',updated_at=excluded.updated_at`)
      .run(E2E_BOOTSTRAP_ADMIN_ID, authorityId, now, now);
    database.prepare(`UPDATE authority_role_bindings SET subject_type=NULL,subject_id=NULL,
      status='active',grant_version=1,granted_by=?,updated_at=?,revoked_at=NULL
      WHERE authority_id=? AND user_id=? AND role='super_admin'`)
      .run(E2E_BOOTSTRAP_ADMIN_ID, now, authorityId, E2E_BOOTSTRAP_ADMIN_ID);
    database.prepare(`INSERT INTO primary_host_epochs
      (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
       challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
       host_public_key,credential_version,row_version,created_at,updated_at,activated_at,retired_at)
      VALUES(?,1,?,?,'isolated-host-authorization','active','bootstrap',NULL,
       'isolated-host-challenge','isolated-db-digest',1,'isolated-store',?,?,?,1,1,?,?,?,NULL)
      ON CONFLICT(id) DO UPDATE SET device_id=excluded.device_id,user_id=excluded.user_id,
        status='active',db_authority_id=excluded.db_authority_id,
        host_credential_hash=excluded.host_credential_hash,host_public_key=excluded.host_public_key,
        updated_at=excluded.updated_at,activated_at=excluded.activated_at,retired_at=NULL`)
      .run(hostEpochId, hostDeviceId, E2E_BOOTSTRAP_ADMIN_ID, authorityId,
        hostCredentialHash, hostPublicKey, now, now, now);
    })();
  } finally {
    database.pragma('foreign_keys = ON');
  }
  return res.json({ success: true });
});
app.get('/__e2e/state', (_req, res) => {
  const challenges = database.prepare(`SELECT device_id AS deviceId, device_kind AS deviceKind,
    status, claimed_user_id AS claimedUserId, row_version AS rowVersion
    FROM desktop_identity_challenges ORDER BY created_at ASC`).all();
  const authorizations = database.prepare(`SELECT device_id AS deviceId, device_kind AS deviceKind,
    status, user_id AS userId FROM desktop_device_authorizations ORDER BY created_at ASC`).all();
  const authorityAccounts = database.prepare(`SELECT user_id AS userId, authority_id AS authorityId,
    status FROM authority_accounts ORDER BY user_id ASC`).all();
  const authorityRoleBindings = database.prepare(`SELECT binding_id AS bindingId,
    authority_id AS authorityId, user_id AS userId, role, subject_type AS subjectType,
    subject_id AS subjectId, status, grant_version AS grantVersion
    FROM authority_role_bindings ORDER BY binding_id ASC`).all();
  const loginEvents = database.prepare(`SELECT user_id AS userId, result_code AS resultCode,
    created_at AS createdAt FROM miniapp_login_events ORDER BY created_at DESC`).all();
  const e2eUsers = database.prepare(`SELECT id,
    CASE wechat_openid
      WHEN 'isolated-miniapp-visitor' THEN 'miniapp_visitor'
      WHEN 'isolated-desktop-confirmation-user' THEN 'desktop_confirmation_admin'
    END AS identityKind
    FROM users WHERE wechat_openid IN ('isolated-miniapp-visitor','isolated-desktop-confirmation-user')
    ORDER BY id ASC`).all();
  const hostState = {
    tables: database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'primary_host_%' ORDER BY name")
      .all().map(row => row.name),
    operationChallengeColumns: database.prepare('PRAGMA table_info(primary_host_operation_challenges)')
      .all().map(row => row.name),
    operationChallenges: database.prepare(`SELECT id, operation, status, target_device_id AS targetDeviceId,
      verified_user_id AS verifiedUserId, row_version AS rowVersion
      FROM primary_host_operation_challenges ORDER BY created_at ASC`).all(),
    epochs: database.prepare(`SELECT id, status, generation, device_id AS deviceId, user_id AS userId
      FROM primary_host_epochs ORDER BY created_at ASC`).all(),
  };
  return res.json({ success: true, data: {
    challenges, authorizations, authorityAccounts, authorityRoleBindings, loginEvents, e2eUsers,
    hostState, latestBootstrapAttempt, latestCredentialVerification,
  } });
});
app.get('/__e2e/health', (_req, res) => res.json({ success: true }));
const server = http.createServer(app);
app.set('cloudRelaySocketServer', new CloudRelaySocketServer(server, { db: database }));
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, port })));
