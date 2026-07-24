const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/src/services/cloudRelayClient.js', 'utf-8');
const backendRoute = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf-8');
const gatewayRoute = fs.readFileSync('gateway/src/routes/cloudRelay.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');
const client = require('./cloudRelayClient');

assert.strictEqual(client.IDENTITY_PROVISIONING_CAPABILITY, 'identity-provisioning-v1');
assert.strictEqual(client.DESKTOP_PAIRING_CAPABILITY, 'desktop-pairing-v1');
assert.deepStrictEqual(client.hostCapabilities(), ['identity-provisioning-v1', 'desktop-pairing-v1']);

assert.ok(source.includes('publishHeartbeat'), 'cloud relay client should publish heartbeat');
assert.ok(source.includes('publishSnapshot'), 'cloud relay client should publish snapshot');
assert.ok(source.includes('fetchPendingTasks'), 'cloud relay client should fetch pending tasks');
assert.ok(source.includes('completeMiniappTask'), 'cloud relay client should complete miniapp tasks');
assert.ok(source.includes('/api/cloud/tasks/${taskId}/complete'), 'cloud relay client should call task completion endpoint');
assert.ok(source.includes('buildHeaders'), 'cloud relay client should build authenticated headers');
assert.ok(source.includes('Authorization'), 'cloud relay client should forward Authorization when provided');
assert.ok(packageJson.includes('backend/src/services/cloudRelayClient.test.js'), 'cloud relay client test should run in npm test');
assert.ok(backendRoute.includes("router.get('/tasks/:id/state'"));
assert.ok(gatewayRoute.includes("router.get('/tasks/:id/state'"));

assert.deepStrictEqual(client.buildHeaders({ hostToken: 'bootstrap-root-token' }), {
  'Content-Type': 'application/json',
  'x-gewu-host-token': 'bootstrap-root-token',
});
assert.deepStrictEqual(client.buildHeaders({
  hostToken: 'must-not-leak-after-bootstrap',
  hostCredential: 'managed-host-credential',
  hostDeviceId: 'host-managed-a',
  hostGeneration: 2,
}), {
  'Content-Type': 'application/json',
  'x-gewu-host-device-id': 'host-managed-a',
  'x-gewu-host-generation': '2',
  'x-gewu-host-credential': 'managed-host-credential',
}, 'managed host credentials must replace the bootstrap root token on network requests');

(async () => {
  const originalFetch = global.fetch;
  const calls = [];
  process.env.GEWU_CLOUD_BASE_URL = 'https://relay.example/scheduling';
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return { json: async () => ({ success: true, task: null }) };
  };
  try {
    const auth = { hostToken: 'trusted-host-token' };
    await client.publishDesktopPairingCapability({
      hostDeviceId: 'host-a',
      epochId: 'epoch-a',
      generation: 1,
      capability: { id: 'capability-a' },
    }, auth);
    await client.claimMiniappTask({ hostDeviceId: 'host-a', leaseMs: 5000 }, auth);
    await client.updateMiniappTaskProgress('task-1', { claimToken: 'claim', expectedRowVersion: 1, progress: 40, phase: 'rendering' }, auth);
    await client.completeMiniappTask('task-1', { claimToken: 'claim', expectedRowVersion: 2, result: { ok: true } }, auth);
    await client.failMiniappTask('task-2', { claimToken: 'claim-2', expectedRowVersion: 1, errorCode: 'FAILED' }, auth);
    await client.queryMiniappTaskState('task-1', { ...auth, hostDeviceId: 'host-a' });
    await client.fetchPendingTasks({ ...auth, hostDeviceId: 'host-a', leaseMs: 5000 });
    assert.deepStrictEqual(calls.map(call => call.url), [
      'https://relay.example/api/cloud/host/heartbeat',
      'https://relay.example/api/cloud/desktop-pairing/capability',
      'https://relay.example/api/cloud/tasks/claim',
      'https://relay.example/scheduling/api/cloud/tasks/claim',
      'https://relay.example/scheduling/api/cloud/tasks/task-1/progress',
      'https://relay.example/scheduling/api/cloud/tasks/task-1/complete',
      'https://relay.example/scheduling/api/cloud/tasks/task-2/fail',
      'https://relay.example/scheduling/api/cloud/tasks/task-1/state?hostDeviceId=host-a',
      'https://relay.example/scheduling/api/cloud/tasks?status=pending_host&hostDeviceId=host-a&leaseMs=5000',
    ]);
    assert.ok(calls.every(call => call.options.headers['x-gewu-host-token'] === 'trusted-host-token'));
    assert.deepStrictEqual(calls[0].body, {
      hostDeviceId: 'host-a',
      status: 'online',
      capabilities: ['identity-provisioning-v1', 'desktop-pairing-v1'],
    }, 'pairing publication should first register a fresh Gateway heartbeat');
    assert.strictEqual(calls[1].body.capability.id, 'capability-a');
    assert.strictEqual(calls[2].body.hostDeviceId, 'host-a');
    assert.strictEqual(calls[3].body.hostDeviceId, 'host-a');

    const gatewayCalls = [];
    global.fetch = async (url, options = {}) => {
      gatewayCalls.push({ url, options });
      if (url.endsWith('/api/cloud/tasks/claim')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            task: { id: 'desktop-pairing-1', task_type: 'desktop-pairing', row_version: 1 },
            claimToken: 'pairing-claim',
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    const gatewayPairingClaim = await client.claimMiniappTask(
      { hostDeviceId: 'host-a', leaseMs: 5000 },
      auth
    );
    assert.strictEqual(
      gatewayPairingClaim.relayBaseUrl,
      'https://relay.example',
      'Gateway pairing tasks must retain their source relay for progress and completion callbacks'
    );
    await client.completeMiniappTask(
      gatewayPairingClaim.task.id,
      { claimToken: gatewayPairingClaim.claimToken, expectedRowVersion: 1, result: { ok: true } },
      { ...auth, relayBaseUrl: gatewayPairingClaim.relayBaseUrl }
    );
    assert.deepStrictEqual(gatewayCalls.map(call => call.url), [
      'https://relay.example/api/cloud/tasks/claim',
      'https://relay.example/api/cloud/tasks/desktop-pairing-1/complete',
    ]);

    global.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ success: false, code: 'TASK_VERSION_CONFLICT', error: 'stale row version' }),
    });
    await assert.rejects(
      () => client.completeMiniappTask('task-stale', { claimToken: 'claim', expectedRowVersion: 1 }, auth),
      error => error.code === 'TASK_VERSION_CONFLICT' && error.statusCode === 409,
      'non-2xx task responses must reject with the relay error contract'
    );

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: false, code: 'TASK_REJECTED', error: 'relay rejected task' }),
    });
    await assert.rejects(
      () => client.fetchPendingTasks(auth),
      error => error.code === 'TASK_REJECTED' && error.statusCode === 200,
      'HTTP 200 responses with success=false must reject instead of being treated as success'
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env.GEWU_CLOUD_BASE_URL;
  }
  console.log('cloudRelayClient checks passed');
})().catch(error => { console.error(error); process.exit(1); });
