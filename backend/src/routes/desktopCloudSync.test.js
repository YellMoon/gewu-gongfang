const assert = require('assert');
const fs = require('fs');

const cloudRelay = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf-8');
const hostRelay = fs.readFileSync('backend/src/routes/cloudRelayHost.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(
  cloudRelay.includes("router.get('/host/status'"),
  'cloud relay should expose host status for one-click sync transport selection'
);
assert.ok(
  !cloudRelay.includes("router.use('/host', requireHostWrite)"),
  'host status should not be blocked by the host-write middleware used for heartbeat writes'
);
assert.ok(
  cloudRelay.includes("router.get('/host/status', requireDesktopSyncAccess"),
  'desktop clients should be able to read host status with the desktop sync token'
);
assert.ok(
  cloudRelay.includes('lan_urls') && cloudRelay.includes('lanUrls'),
  'cloud relay should save and return host LAN URLs for automatic direct sync discovery'
);
assert.ok(
  hostRelay.includes('GEWU_HOST_LAN_URLS'),
  'host heartbeat should publish LAN URLs discovered by the desktop host process'
);
assert.ok(
  cloudRelay.includes("router.post('/desktop-sync/requests'"),
  'cloud relay should accept desktop sync requests from remote clients'
);
assert.ok(
  cloudRelay.includes("router.get('/desktop-sync/requests/:id/result'"),
  'cloud relay should expose desktop sync request result polling'
);
assert.ok(
  cloudRelay.includes("task_type, status, payload") && cloudRelay.includes("'desktop-sync'"),
  'desktop sync requests should be stored as pending host tasks'
);
assert.ok(
  hostRelay.includes("task.task_type === 'desktop-sync'"),
  'host task processor should recognize desktop sync tasks'
);
assert.ok(
  hostRelay.includes('applySyncChanges'),
  'host task processor should apply desktop sync changes to the primary host database'
);
assert.ok(cloudRelay.includes('actorUserId: user.id'), 'relay may forward only an authenticated actor id hint');
assert.ok(!cloudRelay.includes('authorizationContext'), 'relay must not forward trusted role or teacher context');
assert.ok(hostRelay.includes('authz,'), 'host apply must use the shared transaction validator');
assert.ok(hostRelay.includes('verifyRelayAssertion') && hostRelay.includes('resolveOrProvisionRelayActorContext'),
  'host must verify cloud HMAC then rebuild actor context from its local DB');
assert.ok(
  packageJson.includes('backend/src/routes/desktopCloudSync.test.js'),
  'desktop cloud sync route test should run in npm test'
);

console.log('desktop cloud sync relay checks passed');
