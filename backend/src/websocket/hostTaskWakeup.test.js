const assert = require('assert');
const { EventEmitter } = require('events');

const { createHostTaskWakeup, gatewayWebSocketUrl } = require('./hostTaskWakeup');

assert.strictEqual(gatewayWebSocketUrl('https://physicsedu.xyz/scheduling'), 'wss://physicsedu.xyz');
assert.strictEqual(gatewayWebSocketUrl('http://127.0.0.1:3003/api'), 'ws://127.0.0.1:3003');
assert.strictEqual(gatewayWebSocketUrl('wss://physicsedu.xyz/ws/cloud-relay'), 'wss://physicsedu.xyz');
assert.strictEqual(gatewayWebSocketUrl('not a url'), '');

class FakeHostWebSocketClient extends EventEmitter {
  constructor(options) { super(); this.options = options; this.connectCount = 0; this.disconnectCount = 0; }
  connect() { this.connectCount += 1; }
  disconnect() { this.disconnectCount += 1; }
}

(async () => {
  const requests = [];
  const wakeup = createHostTaskWakeup({
    runtimeConfig: { nodeRole: 'primary-host', deviceId: 'host-1', cloudBaseUrl: 'https://physicsedu.xyz/scheduling', desktopSyncToken: 'local-sync-secret' },
    HostWebSocketClient: FakeHostWebSocketClient,
    hostToken: 'gateway-host-secret',
    localPort: 3901,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ success: true, processed: 1 }) };
    },
  });
  assert.ok(wakeup, 'a configured primary host must create a task wakeup client');
  assert.strictEqual(wakeup.client.options.gatewayUrl, 'wss://physicsedu.xyz');
  assert.strictEqual(wakeup.client.options.hostDeviceId, 'host-1');
  wakeup.start();
  assert.strictEqual(wakeup.client.connectCount, 1);
  wakeup.client.emit('new_task', { taskId: 'desktop_sync_1' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(requests.length, 1, 'a WebSocket task notification must wake local host task processing');
  assert.strictEqual(requests[0].url, 'http://127.0.0.1:3901/api/cloud-relay-host/tasks/process');
  assert.strictEqual(requests[0].options.headers['x-gewu-desktop-sync-token'], 'local-sync-secret');
  wakeup.stop();
  assert.strictEqual(wakeup.client.disconnectCount, 1);
  assert.strictEqual(createHostTaskWakeup({ runtimeConfig: { nodeRole: 'desktop-client' }, HostWebSocketClient: FakeHostWebSocketClient }), null);
  console.log('host WebSocket task wakeup checks passed');
})().catch(error => { console.error(error); process.exit(1); });
