'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const {
  createSignedAuthorityProjection,
} = require('../shared/authorityProjectionProtocol');

const source = fs.readFileSync(path.join(__dirname, 'isolated-desktop-identity-cloud.js'), 'utf8');

assert.match(source, /Access-Control-Allow-Origin/, 'the disposable control plane must return CORS headers to the packaged file-origin renderer');
assert.match(source, /const ISOLATED_JSON_BODY_LIMIT = '50mb';/,
  'the disposable control plane must keep its large authority payload limit as an explicit named constant');
assert.match(source, /express\.json\(\{ limit: ISOLATED_JSON_BODY_LIMIT \}\)/,
  'the disposable control plane must wire the named 50 MiB limit into its JSON parser');
assert.match(source, /app\.options\('\/\{\*splat\}'/, 'the disposable control plane must answer the renderer preflight request with Express 5 compatible routing');
assert.match(source, /app\.post\('\/api\/cloud\/host\/heartbeat'/, 'isolated cloud must accept the host heartbeat used by packaged data hosts');
assert.match(source, /app\.post\('\/api\/cloud\/tasks\/claim'/, 'isolated cloud must let packaged data hosts claim relay tasks');
assert.match(source, /createAuthorityProtocolRouter/, 'isolated cloud must exercise the backend authority control plane');
assert.doesNotMatch(source, /createGatewayAuthorityProtocolRouter/, 'isolated cloud must not create a second gateway inbox');
assert.match(source, /app\.use\('\/api\/authority'/, 'isolated cloud must mount the formal authority command and projection routes');
assert.match(source, /CloudRelaySocketServer/, 'isolated cloud must run the backend authority WebSocket relay on the same database');
assert.doesNotMatch(source, /gateway\/src\/websocket\/server/, 'isolated acceptance must not revive the split gateway WebSocket database');
assert.match(source, /http\.createServer\(app\)/, 'the isolated backend WebSocket server must share the formal HTTP control-plane listener');
assert.doesNotMatch(source, /\/api\/cloud\/desktop-session\//, 'isolated cloud must not retain the retired desktop-session relay surface');
assert.doesNotMatch(source, /createDesktopSessionRelayService/, 'isolated cloud must not instantiate the retired desktop-session relay service');
assert.match(source, /hostState/, 'isolated cloud state endpoint must report primary-host bootstrap state for real desktop E2E diagnosis');
assert.match(source, /__e2e\/confirm-latest-primary-host/, 'isolated cloud must confirm the primary-host WeChat identity step during disposable UI E2E');
assert.ok(
  source.indexOf('process.env.JWT_SECRET = jwtSecret')
    < source.indexOf("require('../backend/src/routes/desktopIdentity')"),
  'the disposable JWT secret must exist before backend authentication modules capture it',
);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitForCloud(baseUrl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/__e2e/health`)).ok) return;
    } catch (_error) { /* the disposable process is still starting */ }
    await sleep(100);
  }
  throw new Error('ISOLATED_AUTHORITY_CONTROL_PLANE_START_REQUIRED');
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_error) { body = { raw: text }; }
  return { status: response.status, body };
}

function generateDeviceKey() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey: pair.privateKey,
    publicKey,
    keyFingerprint: crypto.createHash('sha256').update(der).digest('hex'),
  };
}

function seedAuthority(root) {
  const db = new Database(path.join(root, 'identity-cloud.db'));
  const now = '2026-08-02T00:00:00.000Z';
  const authorityId = 'isolated-authority-1';
  const hostEpochId = 'isolated-host-epoch-1';
  const hostDeviceId = 'isolated-host-device-1';
  const hostCredential = 'isolated-host-credential-for-tests-only';
  const hostCredentialHash = crypto.createHash('sha256').update(hostCredential).digest('hex');
  const hostKey = crypto.generateKeyPairSync('ed25519');
  const hostPublicKey = hostKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  let hostUser = db.prepare('SELECT id FROM users WHERE phone_normalized=? AND deleted=0')
    .get('13732250653');
  if (!hostUser) {
    db.prepare(`INSERT INTO users
      (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,review_status,
       auth_version,deleted,created_at,updated_at)
      VALUES('isolated-host-admin','13732250653','13732250653','Isolated Host Admin',
        'super_admin','admin',1,1,'approved',1,0,?,?)`).run(now, now);
    hostUser = { id: 'isolated-host-admin' };
  }
  db.prepare(`UPDATE users SET role='super_admin',identity_kind='admin',status=1,
    login_enabled=1,review_status='approved',is_super_admin_identity=1,deleted=0,updated_at=? WHERE id=?`)
    .run(now, hostUser.id);
  db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
    VALUES(?,?,'active',?,?)
    ON CONFLICT(user_id) DO UPDATE SET authority_id=excluded.authority_id,
      status='active',updated_at=excluded.updated_at`).run(hostUser.id, authorityId, now, now);
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
    VALUES('isolated-host-admin-binding',?,?,'super_admin',NULL,NULL,
      'active',1,?,?)`).run(authorityId, hostUser.id, now, now);
  db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO primary_host_epochs
    (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
     challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
     host_public_key,credential_version,row_version,created_at,updated_at,activated_at,retired_at)
    VALUES(?,1,?,?,'isolated-host-authorization','active','bootstrap',NULL,
      'isolated-host-challenge','isolated-db-digest',1,'isolated-store',?,?,?,1,1,?,?,?,NULL)`)
    .run(hostEpochId, hostDeviceId, hostUser.id, authorityId, hostCredentialHash, hostPublicKey, now, now, now);
  db.pragma('foreign_keys = ON');
  db.close();
  return { authorityId, hostEpochId, hostDeviceId, hostCredential, hostKey, hostUserId: hostUser.id };
}

function collect(socket) {
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString('utf8'))));
  return messages;
}

async function waitForMessage(messages, predicate, code) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await sleep(10);
  }
  throw new Error(code);
}

async function rejectUnauthenticatedAuthoritySocket(baseUrl) {
  const url = baseUrl.replace(/^http:/, 'ws:') + '/ws/authority';
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ISOLATED_AUTHORITY_SOCKET_AUTH_REQUIRED')), 10_000);
    socket.once('close', code => { clearTimeout(timer); resolve(code); });
  });
  socket.send(JSON.stringify({ protocol: 'gewu.authority-socket.v1', type: 'command.submit' }));
  assert.strictEqual(await closed, 1008);
}

(async function verifyRunningControlPlane() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-real-desktop-identity-cloud-test-'));
  const port = await freePort();
  const child = childProcess.spawn(process.execPath, [
    path.join(__dirname, 'isolated-desktop-identity-cloud.js'), root, String(port),
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let childOutput = '';
  child.stdout.on('data', data => { childOutput += data.toString('utf8'); });
  child.stderr.on('data', data => { childOutput += data.toString('utf8'); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForCloud(baseUrl);
    const authorityFixture = seedAuthority(root);
    const projection = createSignedAuthorityProjection({
      authorityId: authorityFixture.authorityId,
      hostEpochId: authorityFixture.hostEpochId,
      userId: authorityFixture.hostUserId,
      role: 'super_admin',
      sourceVersion: 1,
      generatedAt: '2026-08-02T00:00:01.000Z',
      payload: {
        schedules: [],
        courses: [],
        assets: [],
        questionPreviews: [],
        roleApplications: [],
        roleGrants: [{
          bindingId: 'isolated-host-admin-binding',
          authorityId: authorityFixture.authorityId,
          userId: authorityFixture.hostUserId,
          role: 'super_admin',
          subjectType: null,
          subjectId: null,
          status: 'active',
          grantVersion: 1,
          grantedBy: authorityFixture.hostUserId,
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
          revokedAt: null,
        }],
        auditEvidence: 'x'.repeat(96 * 1024),
      },
      privateKey: authorityFixture.hostKey.privateKey,
    });
    assert.ok(Buffer.byteLength(JSON.stringify({ projection })) > 64 * 1024);
    const published = await requestJson(baseUrl, '/api/authority/host/projections', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gewu-host-device-id': authorityFixture.hostDeviceId,
        'x-gewu-host-generation': '1',
        'x-gewu-host-credential': authorityFixture.hostCredential,
      },
      body: JSON.stringify({ projection }),
    });
    assert.strictEqual(published.status, 200, JSON.stringify(published.body));
    assert.strictEqual(published.body.projection.payload.auditEvidence.length, 96 * 1024);

    const miniappLogin = await requestJson(baseUrl, '/api/auth/wechat-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'isolated-native-miniapp-login', phone: '19972110031' }),
    });
    assert.strictEqual(miniappLogin.status, 200, JSON.stringify(miniappLogin.body));
    const miniappRelogin = await requestJson(baseUrl, '/api/auth/wechat-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'isolated-native-miniapp-relogin', phone: '19972110031' }),
    });
    assert.strictEqual(miniappRelogin.status, 200, JSON.stringify(miniappRelogin.body));
    assert.strictEqual(miniappRelogin.body.data.userId, miniappLogin.body.data.userId);

    const desktopKey = generateDeviceKey();
    const desktopChallenge = await requestJson(baseUrl, '/api/desktop-identity/challenges/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'isolated-desktop-confirmation-device',
        deviceName: 'Isolated Desktop Confirmation',
        publicKey: desktopKey.publicKey,
        keyFingerprint: desktopKey.keyFingerprint,
      }),
    });
    assert.strictEqual(desktopChallenge.status, 200, JSON.stringify(desktopChallenge.body));
    const confirmed = await requestJson(baseUrl, '/__e2e/confirm-latest', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(confirmed.status, 200, JSON.stringify(confirmed.body));
    const identityDb = new Database(path.join(root, 'identity-cloud.db'), { readonly: true });
    const miniappUser = identityDb.prepare('SELECT id,wechat_openid FROM users WHERE phone_normalized=?')
      .get('19972110031');
    const desktopConfirmationUser = identityDb.prepare('SELECT id,wechat_openid FROM users WHERE phone_normalized=?')
      .get('13732250653');
    identityDb.close();
    assert.strictEqual(miniappUser.id, miniappLogin.body.data.userId);
    assert.strictEqual(miniappUser.wechat_openid, 'isolated-miniapp-visitor');
    assert.strictEqual(desktopConfirmationUser.wechat_openid, 'isolated-desktop-confirmation-user');
    assert.notStrictEqual(miniappUser.id, desktopConfirmationUser.id);
    assert.notStrictEqual(miniappUser.wechat_openid, desktopConfirmationUser.wechat_openid);

    const hostSocket = new WebSocket(
      baseUrl.replace(/^http:/, 'ws:') + '/ws/cloud-relay?role=host',
      { headers: {
        'x-gewu-host-device-id': authorityFixture.hostDeviceId,
        'x-gewu-host-generation': '1',
        'x-gewu-host-credential': authorityFixture.hostCredential,
      } },
    );
    const hostMessages = collect(hostSocket);
    hostSocket.on('error', error => { childOutput += `\nhost socket: ${error.message}`; });
    await waitForMessage(hostMessages, message => message.type === 'connected', 'HOST_SOCKET_NOT_CONNECTED');
    const submitted = await requestJson(baseUrl, '/api/miniapp/applications', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${miniappLogin.body.data.token}`,
        'content-type': 'application/json',
        'x-idempotency-key': 'isolated-miniapp-role-application-1',
      },
      body: JSON.stringify({ requestedRole: 'student' }),
    });
    assert.strictEqual(submitted.status, 202, JSON.stringify(submitted.body));
    const notified = await waitForMessage(hostMessages,
      message => message.type === 'new_task', 'HOST_QUEUE_NOTIFICATION_REQUIRED');
    assert.strictEqual(notified.payload.taskId, submitted.body.command.id);
    const claimed = await requestJson(baseUrl, '/api/authority/host/commands/claim', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gewu-host-device-id': authorityFixture.hostDeviceId,
        'x-gewu-host-generation': '1',
        'x-gewu-host-credential': authorityFixture.hostCredential,
      },
      body: JSON.stringify({ claimToken: 'isolated-host-claim-1', leaseMs: 30_000, limit: 5 }),
    });
    assert.strictEqual(claimed.status, 200, JSON.stringify(claimed.body));
    assert.strictEqual(claimed.body.commands[0].commandId, submitted.body.command.id);
    hostSocket.close();

    const authority = await fetch(`${baseUrl}/api/authority/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: 'gewu.authority-command.v1' }),
    });
    assert.strictEqual(authority.status, 401);
    assert.strictEqual((await authority.json()).error.code, 'AUTHORITY_ACTOR_REQUIRED');
    const legacy = await fetch(`${baseUrl}/api/cloud/desktop-session/challenges/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(legacy.status, 404, 'the retired desktop-session route must not be reachable');
    await rejectUnauthenticatedAuthoritySocket(baseUrl);
    console.log('isolated desktop identity authority control plane verified');
  } finally {
    try { childProcess.execFileSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }); } catch (_error) { /* child already exited */ }
    if (child.exitCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await sleep(200);
      }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
