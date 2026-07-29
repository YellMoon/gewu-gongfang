'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const source = fs.readFileSync(path.join(__dirname, 'isolated-desktop-identity-cloud.js'), 'utf8');

assert.match(source, /Access-Control-Allow-Origin/, 'the disposable control plane must return CORS headers to the packaged file-origin renderer');
assert.match(source, /app\.options\('\/\{\*splat\}'/, 'the disposable control plane must answer the renderer preflight request with Express 5 compatible routing');
assert.match(source, /app\.post\('\/api\/cloud\/host\/heartbeat'/, 'isolated cloud must accept the host heartbeat used by packaged data hosts');
assert.match(source, /app\.post\('\/api\/cloud\/tasks\/claim'/, 'isolated cloud must let packaged data hosts claim relay tasks');
assert.match(source, /createGatewayAuthorityProtocolRouter/, 'isolated cloud must exercise the formal gateway authority control plane');
assert.match(source, /app\.use\('\/api\/authority'/, 'isolated cloud must mount the formal authority command and projection routes');
assert.match(source, /CloudWebSocketServer/, 'isolated cloud must run the formal gateway authority WebSocket relay server');
assert.match(source, /http\.createServer\(app\)/, 'the isolated gateway WebSocket server must share the formal HTTP control-plane listener');
assert.doesNotMatch(source, /\/api\/cloud\/desktop-session\//, 'isolated cloud must not retain the retired desktop-session relay surface');
assert.doesNotMatch(source, /createDesktopSessionRelayService/, 'isolated cloud must not instantiate the retired desktop-session relay service');
assert.match(source, /hostState/, 'isolated cloud state endpoint must report primary-host bootstrap state for real desktop E2E diagnosis');
assert.match(source, /__e2e\/confirm-latest-primary-host/, 'isolated cloud must confirm the primary-host WeChat identity step during disposable UI E2E');

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

async function receiveAuthoritySocketReady(baseUrl) {
  const url = baseUrl.replace(/^http:/, 'ws:') + '/ws/authority';
  const socket = new WebSocket(url);
  try {
    const frame = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ISOLATED_AUTHORITY_SOCKET_READY_REQUIRED')), 10_000);
      socket.once('error', error => { clearTimeout(timer); reject(error); });
      socket.once('message', data => { clearTimeout(timer); resolve(JSON.parse(data.toString('utf8'))); });
    });
    assert.deepStrictEqual(frame, { protocol: 'gewu.authority-socket.v1', type: 'ready' });
  } finally {
    socket.close();
  }
}

(async function verifyRunningControlPlane() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-real-desktop-identity-cloud-test-'));
  const port = await freePort();
  const child = childProcess.spawn(process.execPath, [
    path.join(__dirname, 'isolated-desktop-identity-cloud.js'), root, String(port),
  ], { windowsHide: true, stdio: 'ignore' });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForCloud(baseUrl);
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
    await receiveAuthoritySocketReady(baseUrl);
    console.log('isolated desktop identity authority control plane verified');
  } finally {
    try { childProcess.execFileSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }); } catch (_error) { /* child already exited */ }
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
