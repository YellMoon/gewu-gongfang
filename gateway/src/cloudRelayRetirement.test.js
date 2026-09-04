'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const createApp = require('./app');
const retiredRuntimeModules = [
  './routes/cloudRelay',
  './routes/auth',
  './routes/admin',
  './routes/permissions',
  './websocket/server',
  './db/database',
].map(modulePath => path.join(__dirname, `${modulePath}.js`));

async function request(baseUrl, pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const body = await response.json();
  return { response, body };
}

function expectWebSocketRejected(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 1500 });
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on('error', () => {});
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for obsolete WebSocket endpoint to reject ${url}`));
    }, 2500);

    socket.once('open', () => {
      finish(new Error(`Obsolete WebSocket endpoint still accepted a connection: ${url}`));
    });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      finish();
    });
    socket.once('error', () => finish());
    socket.once('close', () => finish());
  });
}

(async () => {
  let server;
  try {
    assert.strictEqual(
      typeof createApp.createGatewayServer,
      'function',
      'tests must start the same formal gateway server used by the 3001 runtime',
    );

    ({ server } = createApp.createGatewayServer());
    assert.strictEqual(
      server.listenerCount('upgrade'),
      0,
      'the formal gateway runtime must not install a legacy WebSocket upgrade handler',
    );
    for (const modulePath of retiredRuntimeModules) {
      assert.strictEqual(
        fs.existsSync(modulePath),
        false,
        `retired gateway authority module must be deleted: ${path.relative(__dirname, modulePath)}`,
      );
    }

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const retiredRequests = [
      { pathname: '/api/cloud', code: 'CLOUD_RELAY_RETIRED' },
      { pathname: '/api/cloud/tasks/legacy-task?include=result', code: 'CLOUD_RELAY_RETIRED' },
      {
        pathname: '/api/cloud/desktop-pairing/capability',
        code: 'CLOUD_RELAY_RETIRED',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        },
      },
      { pathname: '/api/cloud/anything', code: 'CLOUD_RELAY_RETIRED', init: { method: 'DELETE' } },
      { pathname: '/api/cloud', code: 'CLOUD_RELAY_RETIRED', init: { method: 'OPTIONS' } },
      {
        pathname: '/api/auth/login',
        code: 'GATEWAY_AUTH_RETIRED',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        },
      },
      { pathname: '/api/auth/refresh', code: 'GATEWAY_AUTH_RETIRED' },
      { pathname: '/api/admin/users', code: 'GATEWAY_ADMIN_RETIRED' },
      { pathname: '/api/admin/roles/teacher', code: 'GATEWAY_ADMIN_RETIRED', init: { method: 'PATCH' } },
      { pathname: '/api/permissions/my', code: 'GATEWAY_PERMISSIONS_RETIRED' },
      { pathname: '/api/permissions/check', code: 'GATEWAY_PERMISSIONS_RETIRED', init: { method: 'POST' } },
    ];

    for (const { pathname, code, init } of retiredRequests) {
      const { response, body } = await request(baseUrl, pathname, init);
      assert.strictEqual(response.status, 410, `${pathname} must be a permanent tombstone`);
      assert.strictEqual(body.success, false, `${pathname} must not report a successful relay`);
      assert.strictEqual(body.code, code, `${pathname} must use the retirement code`);
    }

    const health = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(health.status, 200, 'gateway health must remain available');
    assert.strictEqual((await health.json()).legacyAuthority, 'retired');

    const reviewDemo = await request(baseUrl, '/api/auth/review-demo', { method: 'POST' });
    assert.strictEqual(reviewDemo.response.status, 410, 'the existing review-demo tombstone must remain available');
    assert.strictEqual(reviewDemo.body.code, 'REVIEW_DEMO_REMOVED');

    const nearMatch = await fetch(`${baseUrl}/api/cloudish`);
    assert.strictEqual(nearMatch.status, 404, 'the tombstone must remain scoped to /api/cloud path boundaries');

    await expectWebSocketRejected(`ws://127.0.0.1:${port}/ws/authority`);
    await expectWebSocketRejected(`ws://127.0.0.1:${port}/ws/cloud-relay`);

    const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
    assert.doesNotMatch(appSource, /CloudWebSocketServer/, 'formal runtime must not initialize the legacy WebSocket server');
    assert.doesNotMatch(appSource, /cloudRelayRouter/, 'formal runtime must not mount the legacy cloud relay router');
    assert.doesNotMatch(appSource, /authRouter/, 'formal runtime must not mount the legacy authentication router');
    assert.doesNotMatch(appSource, /adminRouter/, 'formal runtime must not mount the legacy administration router');
    assert.doesNotMatch(appSource, /permissionsRouter/, 'formal runtime must not mount the legacy permissions router');
    assert.doesNotMatch(appSource, /initDatabase|getDb/, 'formal runtime must not initialize the retired local authority database');
    assert.doesNotMatch(appSource, /app\.set\(['"]wsServer['"]/, 'formal runtime must not expose the old relay server');
  } finally {
    if (server?.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  }

  console.log('gateway cloud relay retirement checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
