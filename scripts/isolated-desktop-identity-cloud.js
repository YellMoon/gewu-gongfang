'use strict';

// Disposable identity plane for real packaged-Electron UI verification only.
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { DatabaseService } = require('../backend/src/database');
const { createDesktopIdentityService } = require('../backend/src/services/desktopIdentityService');
const { createDesktopSessionService } = require('../backend/src/services/desktopSessionService');
const { createMiniappIdentityService } = require('../backend/src/services/miniappIdentityService');
const { createPrimaryHostIdentityService } = require('../backend/src/services/primaryHostIdentityService');
const { createDesktopIdentityRouter } = require('../backend/src/routes/desktopIdentity');
const taskService = require('../backend/src/services/cloudRelayTaskService');
const { createGatewayAuthorityProtocolRouter } = require('../gateway/src/routes/authorityProtocol');
const CloudWebSocketServer = require('../gateway/src/websocket/server');

const root = path.resolve(process.argv[2] || '');
const port = Number(process.argv[3] || 0);
if (!path.basename(root).startsWith('tmp-real-desktop-identity-cloud-') || !Number.isSafeInteger(port)) {
  throw new Error('ISOLATED_IDENTITY_CLOUD_ARGUMENTS_REQUIRED');
}
fs.mkdirSync(root, { recursive: true });
process.env.DB_PATH = path.join(root, 'identity-cloud.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
const database = new DatabaseService().db;
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
const jwtSecret = 'isolated-desktop-identity-cloud-test-secret';
// The formal cloud-relay WebSocket server verifies desktop session tokens with
// this process-level value.  This is only the disposable isolated plane.
process.env.JWT_SECRET = jwtSecret;
const identity = createDesktopIdentityService({ db: database });
const sessions = createDesktopSessionService({ db: database, jwtSecret });
const miniapp = createMiniappIdentityService({ db: database, jwtSecret });
const primaryHost = createPrimaryHostIdentityService({ db: database });
const e2eWechatIdentity = { openid: 'e2e-shared-user', phone: '13732250653' };
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
app.use(express.json({ limit: '64kb' }));
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
// The isolated control plane uses the same signed authority router as the
// gateway.  It intentionally has no desktop-session relay compatibility path.
app.use('/api/authority', createGatewayAuthorityProtocolRouter({ db: database }));
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
app.get('/__e2e/state', (_req, res) => {
  const challenges = database.prepare(`SELECT device_id AS deviceId, device_kind AS deviceKind,
    status, claimed_user_id AS claimedUserId, row_version AS rowVersion
    FROM desktop_identity_challenges ORDER BY created_at ASC`).all();
  const authorizations = database.prepare(`SELECT device_id AS deviceId, device_kind AS deviceKind,
    status, user_id AS userId FROM desktop_device_authorizations ORDER BY created_at ASC`).all();
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
    challenges, authorizations, hostState, latestBootstrapAttempt, latestCredentialVerification,
  } });
});
app.get('/__e2e/health', (_req, res) => res.json({ success: true }));
const server = http.createServer(app);
new CloudWebSocketServer(server, { db: database });
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, port })));
