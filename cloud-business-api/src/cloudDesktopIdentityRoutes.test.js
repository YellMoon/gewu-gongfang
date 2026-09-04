'use strict';

const assert = require('assert');
const { once } = require('events');
const { createCloudBusinessApp } = require('./app');

const calls = [];
let startChallengeError = null;
const desktopCloudIdentity = {
  async startChallenge(body) {
    calls.push(['start', body]);
    if (startChallengeError) throw startChallengeError;
    return { id: 'challenge-1' };
  },
  async exchangeChallenge(body) { calls.push(['exchange', body]); return { token: 'token-2', session: { id: 'session-2' }, profile: {}, offlineLease: {} }; },
  async switchRole(body) { calls.push(['role', body]); return { token: 'token-3', session: { id: 'session-3' } }; },
  async listDevices(body) { calls.push(['list', body]); return [{ deviceId: 'device-2' }]; },
  async revokeDevice(body) { calls.push(['revoke', body]); return { deviceId: body.deviceId, status: 'revoked', rowVersion: 2 }; },
};

async function request(baseUrl, path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, json: await response.json() };
}

(async () => {
  const app = createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopCloudIdentity });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await request(baseUrl, '/api/desktop-identity/session/challenges/start', {
      method: 'POST', body: { authorizationId: 'session-original-1', deviceId: 'device-1' },
    });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.json, { success: true, data: { challenge: { id: 'challenge-1' } } });

    response = await request(baseUrl, '/api/desktop-identity/session/challenges/challenge-1/exchange', {
      method: 'POST', body: { signature: 'signature', expectedRowVersion: 1 },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.json.data.session.id, 'session-2');

    response = await request(baseUrl, '/api/desktop-identity/session/role', {
      method: 'POST', token: 'current.token', body: { activeRole: 'teacher' },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(calls.find(call => call[0] === 'role')[1].sessionToken, 'current.token');

    response = await request(baseUrl, '/api/desktop-identity/devices', { token: 'current.token' });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.json.data.items, [{ deviceId: 'device-2' }]);

    response = await request(baseUrl, '/api/desktop-identity/devices/device-2/revoke', {
      method: 'POST', token: 'current.token', body: { expectedRowVersion: 1, reason: 'user_request' },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.json.data.authorization.status, 'revoked');

    response = await request(baseUrl, '/api/desktop-identity/session/role', {
      method: 'POST', body: { activeRole: 'teacher' },
    });
    assert.strictEqual(response.status, 401);

    startChallengeError = Object.assign(new Error('VNEXT_DESKTOP_AUTHORIZATION_INVALID'), { code: 'P0001' });
    response = await request(baseUrl, '/api/desktop-identity/session/challenges/start', {
      method: 'POST', body: { authorizationId: 'revoked-session-1', deviceId: 'device-1' },
    });
    assert.strictEqual(response.status, 401,
      'an explicitly invalid or revoked authorization must not be disguised as a network outage');
    assert.deepStrictEqual(response.json, {
      success: false,
      code: 'VNEXT_DESKTOP_AUTHORIZATION_INVALID',
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('cloud desktop identity route checks passed');
})().catch(error => { console.error(error); process.exit(1); });
