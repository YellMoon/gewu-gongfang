const assert = require('assert');
const { EventEmitter } = require('events');

const { createHostTaskWakeup, gatewayWebSocketUrl } = require('./hostTaskWakeup');

assert.strictEqual(gatewayWebSocketUrl('https://physicsedu.xyz/scheduling'), 'wss://physicsedu.xyz/scheduling');
assert.strictEqual(gatewayWebSocketUrl('http://127.0.0.1:3003/api'), 'ws://127.0.0.1:3003/api');
assert.strictEqual(gatewayWebSocketUrl('wss://physicsedu.xyz/ws/cloud-relay'), 'wss://physicsedu.xyz/ws/cloud-relay');
assert.strictEqual(gatewayWebSocketUrl('not a url'), '');

class FakeHostWebSocketClient extends EventEmitter {
  constructor(options) { super(); this.options = options; this.connectCount = 0; this.disconnectCount = 0; this.sent = []; }
  connect() { this.connectCount += 1; }
  disconnect() { this.disconnectCount += 1; }
  send(type, payload) { this.sent.push({ type, payload }); }
}

(async () => {
  let workerWakes = 0;
  const wakeup = createHostTaskWakeup({
    runtimeConfig: { nodeRole: 'primary-host', deviceId: 'host-1', cloudBaseUrl: 'https://physicsedu.xyz/scheduling', hostCredential: 'managed-host-credential', hostGeneration: 2 },
    HostWebSocketClient: FakeHostWebSocketClient,
    worker: { wake: async () => { workerWakes += 1; } },
  });
  assert.ok(wakeup, 'a configured primary host must create a task wakeup client');
  assert.strictEqual(wakeup.client.options.gatewayUrl, 'wss://physicsedu.xyz/scheduling');
  assert.strictEqual(wakeup.client.options.hostDeviceId, 'host-1');
  wakeup.start();
  assert.strictEqual(wakeup.client.connectCount, 1);
  assert.strictEqual(wakeup.status().cloud.state, 'connecting');
  wakeup.client.emit('connected');
  assert.strictEqual(wakeup.status().cloud.state, 'connected');
  wakeup.client.emit('error', Object.assign(new Error('relay unavailable'), { code: 'CLOUD_CONTROL_UNAVAILABLE' }));
  assert.strictEqual(wakeup.status().cloud.state, 'degraded', 'cloud failure must be observable without changing LAN worker state');
  assert.strictEqual(wakeup.status().cloud.lastError, 'CLOUD_CONTROL_UNAVAILABLE');
  wakeup.client.emit('new_task', { taskId: 'desktop_sync_1' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(workerWakes, 1, 'a WebSocket task notification must wake the independent host worker');
  wakeup.stop();
  assert.strictEqual(wakeup.client.disconnectCount, 1);
  assert.strictEqual(createHostTaskWakeup({ runtimeConfig: { nodeRole: 'desktop-client' }, HostWebSocketClient: FakeHostWebSocketClient }), null);
  workerWakes = 0;
  const workerWakeup = createHostTaskWakeup({
    runtimeConfig: { nodeRole: 'primary-host', deviceId: 'host-2', cloudBaseUrl: 'https://physicsedu.xyz/scheduling', hostCredential: 'managed-worker-credential', hostGeneration: 1 },
    HostWebSocketClient: FakeHostWebSocketClient,
    worker: { wake: async () => { workerWakes += 1; } },
  });
  workerWakeup.start();
  workerWakeup.client.emit('new_task', { taskId: 'worker-task' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(workerWakes, 1, 'WebSocket wake must delegate to the independent worker');
  assert.strictEqual(workerWakeup.status().running, true);
  workerWakeup.stop();
  const authorityFrame = { protocol: 'gewu.authority-socket.v1', type: 'command.submit', requestId: 'request-1' };
  const authorityResponse = { protocol: 'gewu.authority-socket.v1', type: 'command.receipt', requestId: 'request-1' };
  const authorityWakeup = createHostTaskWakeup({
    runtimeConfig: { nodeRole: 'primary-host', deviceId: 'host-3', cloudBaseUrl: 'https://physicsedu.xyz/scheduling', hostCredential: 'managed-relay-credential', hostGeneration: 3 },
    HostWebSocketClient: FakeHostWebSocketClient,
    worker: { wake: async () => {} },
    authorityFrameHandler: { handle: async frame => {
      assert.strictEqual(frame, authorityFrame);
      return authorityResponse;
    } },
  });
  authorityWakeup.start();
  authorityWakeup.client.emit('authority_command_forward', {
    relayRequestId: 'relay-1',
    frame: authorityFrame,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepStrictEqual(authorityWakeup.client.sent, [{
    type: 'authority_command_result',
    payload: { relayRequestId: 'relay-1', response: authorityResponse },
  }]);
  authorityWakeup.stop();
  console.log('host WebSocket task wakeup checks passed');
})().catch(error => { console.error(error); process.exit(1); });
