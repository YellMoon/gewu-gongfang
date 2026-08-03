const assert = require('assert');
const { requireWriteAccess } = require('./auth');

let nextCalled = false;
const rejected = {
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
};

requireWriteAccess({
  method: 'POST',
  baseUrl: '/api/cloud-relay-host',
  path: '/heartbeat',
  headers: { 'x-gewu-desktop-sync-token': 'retired-shared-secret' },
}, rejected, () => {
  nextCalled = true;
});

assert.strictEqual(nextCalled, false, 'retired shared relay secrets must not authorize host writes');
assert.strictEqual(rejected.statusCode, 401);
assert.strictEqual(rejected.body?.code, 'UNAUTHORIZED');

requireWriteAccess({
  method: 'POST',
  baseUrl: '/api/cloud-relay-host',
  path: '/heartbeat',
  headers: {},
  user: { id: 'host-admin', role: 'admin', tenantId: 'default' },
}, {
  status(code) {
    throw new Error(`unexpected status ${code}`);
  },
}, () => {
  nextCalled = true;
});

assert.strictEqual(nextCalled, true, 'an authenticated authorized host session should permit host writes');
console.log('host relay write access checks passed');
