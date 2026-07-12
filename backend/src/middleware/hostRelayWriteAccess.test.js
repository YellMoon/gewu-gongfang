const assert = require('assert');
const { requireWriteAccess } = require('./auth');

const previousToken = process.env.GEWU_DESKTOP_SYNC_TOKEN;
process.env.GEWU_DESKTOP_SYNC_TOKEN = 'sync_secret_test';

try {
  let nextCalled = false;
  const req = {
    method: 'POST',
    baseUrl: '/api/cloud-relay-host',
    path: '/heartbeat',
    headers: { 'x-gewu-desktop-sync-token': 'sync_secret_test' },
  };
  const res = {
    status(code) {
      throw new Error(`unexpected status ${code}`);
    },
  };

  requireWriteAccess(req, res, () => {
    nextCalled = true;
  });

  assert.strictEqual(nextCalled, true, 'primary host relay writes should accept the desktop sync token');
  console.log('host relay write access checks passed');
} finally {
  if (previousToken === undefined) {
    delete process.env.GEWU_DESKTOP_SYNC_TOKEN;
  } else {
    process.env.GEWU_DESKTOP_SYNC_TOKEN = previousToken;
  }
}
