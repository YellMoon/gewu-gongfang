'use strict';

const assert = require('assert');
const { createCloudBusinessApp } = require('./app');

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const healthy = await request(createCloudBusinessApp({ query: async () => ({ rows: [{ ok: 1 }] }) }), '/api/health');
  assert.strictEqual(healthy.status, 200);
  assert.deepStrictEqual(healthy.body, { ok: true, database: 'postgresql', businessAuthority: 'cloud' });

  const unavailable = await request(createCloudBusinessApp({ query: async () => { throw new Error('database unavailable'); } }), '/api/health');
  assert.strictEqual(unavailable.status, 503);
  assert.deepStrictEqual(unavailable.body, { ok: false, database: 'unavailable' });

  const calls = [];
  const identity = {
    begin: async input => { calls.push(['begin', input]); return { verificationToken: 'ticket-1' }; },
    register: async input => { calls.push(['register', input]); return { receiptId: 'receipt-1', sessionId: 'session-1', replayed: false, sessionToken: 'session-token-1' }; },
  };
  const verification = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/online-verification', { method: 'POST', body: { phoneCode: 'provider-code' } });
  assert.strictEqual(verification.status, 200);
  assert.deepStrictEqual(verification.body, { ok: true, verificationToken: 'ticket-1' });
  const registration = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: identity }), '/api/desktop/online-registration', { method: 'POST', body: { verificationToken: 'ticket-1', installationId: 'install-1', installationPublicKey: 'public-key', deviceProof: 'proof', idempotencyKey: 'retry-1' } });
  assert.strictEqual(registration.status, 200);
  assert.deepStrictEqual(registration.body, { ok: true, receiptId: 'receipt-1', sessionId: 'session-1', replayed: false, sessionToken: 'session-token-1' });
  assert.deepStrictEqual(calls, [
    ['begin', { phoneCode: 'provider-code' }],
    ['register', { verificationToken: 'ticket-1', installationId: 'install-1', installationPublicKey: 'public-key', deviceProof: 'proof', idempotencyKey: 'retry-1' }],
  ]);
  const denied = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: { begin: async () => { throw Object.assign(new Error('no'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' }); }, register: async () => null } }), '/api/desktop/online-verification', { method: 'POST', body: { phoneCode: 'bad' } });
  assert.strictEqual(denied.status, 403);
  assert.deepStrictEqual(denied.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
  const invalid = await request(createCloudBusinessApp({ query: async () => ({ rows: [] }), desktopRegistration: { begin: async () => { throw Object.assign(new Error('bad input'), { code: 'CLOUD_ONLINE_IDENTITY_INVALID' }); }, register: async () => null } }), '/api/desktop/online-verification', { method: 'POST', body: {} });
  assert.strictEqual(invalid.status, 400);
  assert.deepStrictEqual(invalid.body, { ok: false, code: 'CLOUD_ONLINE_IDENTITY_INPUT_INVALID' });

  console.log('cloud business API health checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
