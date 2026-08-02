'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const {
  createSignedAuthorityProjection,
} = require('../shared/authorityProjectionProtocol');

const NATIVE_MINIAPP_OPENID = 'isolated-native-miniapp-relay-user';

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
assert.match(source, /authorityApiRouter\.get\('\/projections\/current', authenticateAuthorityDevice/,
  'isolated cloud must expose the signed projection read route used when LAN is unavailable');
assert.match(source, /res\.status\(error\?\.statusCode \|\| 403\)/,
  'isolated projection reads must preserve the formal fail-closed error status');
assert.match(source, /CloudRelaySocketServer/, 'isolated cloud must run the backend authority WebSocket relay on the same database');
assert.doesNotMatch(source, /gateway\/src\/websocket\/server/, 'isolated acceptance must not revive the split gateway WebSocket database');
assert.match(source, /http\.createServer\(app\)/, 'the isolated backend WebSocket server must share the formal HTTP control-plane listener');
assert.doesNotMatch(source, /\/api\/cloud\/desktop-session\//, 'isolated cloud must not retain the retired desktop-session relay surface');
assert.doesNotMatch(source, /createDesktopSessionRelayService/, 'isolated cloud must not instantiate the retired desktop-session relay service');
assert.match(source, /hostState/, 'isolated cloud state endpoint must report primary-host bootstrap state for real desktop E2E diagnosis');
assert.match(source, /__e2e\/confirm-latest-primary-host/, 'isolated cloud must confirm the primary-host WeChat identity step during disposable UI E2E');
assert.match(source, /process\.env\.GEWU_E2E_WECHAT_OPENID/,
  'isolated cloud must allow each native miniapp acceptance identity to use a distinct disposable openid');
assert.match(source,
  /process\.env\.WECHAT_DEV_OPENID = process\.env\.GEWU_E2E_WECHAT_OPENID\s*\|\|/,
  'the disposable openid override must reach the miniapp login resolver before auth routes load');
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

function spawnCloud(root, port, onOutput) {
  const child = childProcess.spawn(process.execPath, [
    path.join(__dirname, 'isolated-desktop-identity-cloud.js'), root, String(port),
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GEWU_E2E_WECHAT_OPENID: NATIVE_MINIAPP_OPENID },
  });
  child.stdout.on('data', data => onOutput(data.toString('utf8')));
  child.stderr.on('data', data => onOutput(data.toString('utf8')));
  return child;
}

async function stopCloud(child) {
  if (!child || child.exitCode !== null) return;
  try { childProcess.execFileSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }); } catch (_error) { /* child already exited */ }
  if (child.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
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

function createAuthorityFixture() {
  const authorityId = 'isolated-two-desktop-acceptance';
  const hostEpochId = 'isolated-host-epoch-1';
  const hostDeviceId = 'isolated-host-device-1';
  const hostCredential = 'isolated-host-credential-for-tests-only';
  const hostCredentialHash = crypto.createHash('sha256').update(hostCredential).digest('hex');
  const hostKey = crypto.generateKeyPairSync('ed25519');
  const hostPublicKey = hostKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    authorityId, hostEpochId, hostDeviceId, hostCredential, hostCredentialHash,
    hostKey, hostPublicKey, hostUserId: 'miniapp-admin-13732250653',
  };
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
  let port = await freePort();
  let child;
  let childOutput = '';
  child = spawnCloud(root, port, output => { childOutput += output; });
  let baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForCloud(baseUrl);
    const bootstrapKey = generateDeviceKey();
    const bootstrapChallenge = await requestJson(baseUrl, '/api/desktop-identity/challenges/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: 'isolated-bootstrap-confirmation-device',
        deviceName: 'Isolated Bootstrap Confirmation',
        publicKey: bootstrapKey.publicKey,
        keyFingerprint: bootstrapKey.keyFingerprint,
      }),
    });
    assert.strictEqual(bootstrapChallenge.status, 200, JSON.stringify(bootstrapChallenge.body));
    const bootstrapConfirmed = await requestJson(baseUrl, '/__e2e/confirm-latest', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(bootstrapConfirmed.status, 200, JSON.stringify(bootstrapConfirmed.body));
    const bootstrapState = await requestJson(baseUrl, '/__e2e/state');
    assert.strictEqual(bootstrapState.status, 200, JSON.stringify(bootstrapState.body));
    const bootstrapAccount = bootstrapState.body.data.authorityAccounts.find(row => (
      row.userId === 'miniapp-admin-13732250653' && row.authorityId === 'isolated-two-desktop-acceptance'
    ));
    const bootstrapBinding = bootstrapState.body.data.authorityRoleBindings.find(row => (
      row.userId === 'miniapp-admin-13732250653'
      && row.authorityId === 'isolated-two-desktop-acceptance'
      && row.role === 'super_admin'
    ));
    const bootstrapLogin = bootstrapState.body.data.loginEvents.find(row => (
      row.userId === 'miniapp-admin-13732250653'
    ));
    assert.deepStrictEqual({
      accountStatus: bootstrapAccount?.status,
      bindingStatus: bootstrapBinding?.status,
      subjectType: bootstrapBinding?.subjectType,
      subjectId: bootstrapBinding?.subjectId,
    }, {
      accountStatus: 'active',
      bindingStatus: 'active',
      subjectType: null,
      subjectId: null,
    });
    assert.strictEqual(bootstrapLogin?.resultCode, 'FORMAL_LOGIN_SUCCESS');
    const authorityFixture = createAuthorityFixture();
    const seededAuthority = await requestJson(baseUrl, '/__e2e/seed-authority', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authorityId: authorityFixture.authorityId,
        hostEpochId: authorityFixture.hostEpochId,
        hostDeviceId: authorityFixture.hostDeviceId,
        hostCredentialHash: authorityFixture.hostCredentialHash,
        hostPublicKey: authorityFixture.hostPublicKey,
      }),
    });
    assert.strictEqual(seededAuthority.status, 200, JSON.stringify(seededAuthority.body));
    const seededState = await requestJson(baseUrl, '/__e2e/state');
    assert.strictEqual(seededState.status, 200, JSON.stringify(seededState.body));
    const activeAccounts = new Set(seededState.body.data.authorityAccounts
      .filter(row => row.status === 'active')
      .map(row => `${row.userId}:${row.authorityId}`));
    const orphanedBindings = seededState.body.data.authorityRoleBindings.filter(row => (
      row.userId === authorityFixture.hostUserId
      && row.status === 'active'
      && !activeAccounts.has(`${row.userId}:${row.authorityId}`)
    ));
    assert.strictEqual(orphanedBindings.length, 0, 'isolated authority fixture must not leave cross-authority active bindings');
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
    const identityState = await requestJson(baseUrl, '/__e2e/state');
    assert.strictEqual(identityState.status, 200, JSON.stringify(identityState.body));
    const miniappUser = identityState.body.data.e2eUsers.find(row => row.identityKind === 'miniapp_visitor');
    const desktopConfirmationUser = identityState.body.data.e2eUsers.find(
      row => row.identityKind === 'desktop_confirmation_admin'
    );
    assert.strictEqual(miniappUser.id, miniappLogin.body.data.userId);
    assert.notStrictEqual(miniappUser.id, desktopConfirmationUser.id);

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

    const realAuthorityId = 'real-dba-authority-after-host-bootstrap';
    const restartTimestamp = '2026-08-03T00:00:00.000Z';
    const persistentDb = new Database(path.join(root, 'identity-cloud.db'));
    try {
      persistentDb.transaction(() => {
        persistentDb.prepare(`UPDATE authority_accounts SET authority_id=?,updated_at=?
          WHERE user_id=?`).run(realAuthorityId, restartTimestamp, authorityFixture.hostUserId);
        persistentDb.prepare(`UPDATE authority_role_bindings SET status='revoked',revoked_at=?,updated_at=?
          WHERE user_id=? AND status='active'`)
          .run(restartTimestamp, restartTimestamp, authorityFixture.hostUserId);
        persistentDb.prepare(`INSERT INTO authority_role_bindings
          (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
           granted_by,created_at,updated_at,revoked_at)
          VALUES('real-dba-super-admin-binding',?,?,'super_admin',NULL,NULL,'active',2,?,?,?,NULL)`)
          .run(realAuthorityId, authorityFixture.hostUserId, authorityFixture.hostUserId,
            restartTimestamp, restartTimestamp);
      })();
    } finally {
      persistentDb.close();
    }

    await stopCloud(child);
    port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawnCloud(root, port, output => { childOutput += output; });
    try {
      await waitForCloud(baseUrl);
    } catch (error) {
      error.message = `${error.message}: ${childOutput.slice(-4000)}`;
      throw error;
    }
    const restartedState = await requestJson(baseUrl, '/__e2e/state');
    assert.strictEqual(restartedState.status, 200, JSON.stringify(restartedState.body));
    const restartedAdminAccount = restartedState.body.data.authorityAccounts.find(row => (
      row.userId === authorityFixture.hostUserId
    ));
    assert.strictEqual(restartedAdminAccount?.authorityId, realAuthorityId,
      'a persistent isolated-cloud restart must not move an active admin account back to the bootstrap authority');
    const restartedAdminBindings = restartedState.body.data.authorityRoleBindings.filter(row => (
      row.userId === authorityFixture.hostUserId && row.status === 'active'
    ));
    assert.deepStrictEqual(restartedAdminBindings.map(row => ({
      bindingId: row.bindingId,
      authorityId: row.authorityId,
      role: row.role,
    })), [{
      bindingId: 'real-dba-super-admin-binding',
      authorityId: realAuthorityId,
      role: 'super_admin',
    }], 'a persistent isolated-cloud restart must not revive the cross-authority bootstrap role binding');
    console.log('isolated desktop identity authority control plane verified');
  } finally {
    await stopCloud(child);
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
