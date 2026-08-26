'use strict';

const assert = require('assert');
const http = require('http');

const { startFixtureServer } = require('./capture-miniapp-ui-matrix');
const { cloudSessionUser } = require('../miniapp/src/pages/login/cloudSessionIdentityRuntime');
const TEST_PORT = 3020;

function request(pathname, token, port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(body) }));
    });
    request.once('error', reject);
    request.end();
  });
}

(async () => {
  assert.strictEqual(typeof startFixtureServer, 'function', 'fixture server must be reusable outside the legacy automator runner');
  const { server } = await startFixtureServer(TEST_PORT);
  try {
    const response = await request('/api/miniapp/cloud-context', 'fixture-teacher');
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.identity.accountId, 'fixture-teacher');
    assert.deepStrictEqual(response.body.identity.roles, ['teacher']);
    assert.strictEqual(response.body.identity.status, 'active');
    assert.strictEqual(response.body.identity.profile.type, 'teacher');
    assert.strictEqual(response.body.identity.profile.id, 'fixture-teacher');
    assert.ok(response.body.capabilities.includes('business:teacher-scope'));
    assert.strictEqual(cloudSessionUser(response.body.identity)?.user_type, 'teacher');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('capture miniapp UI fixture test passed');
})().catch(error => {
  console.error(error && (error.stack || error.message || error));
  process.exitCode = 1;
});
