const assert = require('assert');
const { EventEmitter } = require('events');
const HostWebSocketClient = require('./client');

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;

  constructor(url, options = {}) {
    super();
    FakeWebSocket.lastUrl = url;
    FakeWebSocket.lastOptions = options;
    this.readyState = FakeWebSocket.OPEN;
  }

  close() {
    this.readyState = 3;
    this.emit('close', 1000, 'manual');
  }
}

async function main() {
  const client = new HostWebSocketClient({
  hostDeviceId: 'host-test',
  hostCredential: 'managed-credential',
  hostGeneration: 3,
  gatewayUrl: 'wss://physicsedu.xyz/scheduling',
  reconnectInterval: 1,
  WebSocketImpl: FakeWebSocket,
  });
  client.connect();
  assert.strictEqual(
    FakeWebSocket.lastUrl,
    'wss://physicsedu.xyz/scheduling/ws/cloud-relay?deviceId=host-test&role=host',
    'the WebSocket endpoint must never put a host credential in its URL'
  );
  assert.deepStrictEqual(FakeWebSocket.lastOptions.headers, {
    'x-gewu-host-device-id': 'host-test',
    'x-gewu-host-generation': '3',
    'x-gewu-host-credential': 'managed-credential',
  });
  client.disconnect();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.strictEqual(client.reconnectTimer, null, 'manual disconnect must not schedule a reconnect');
  assert.strictEqual(client.isConnected, false);

  const retryTimers = [];
  const retryClient = new HostWebSocketClient({
    hostDeviceId: 'host-retry',
    hostCredential: 'managed-retry-credential',
    hostGeneration: 2,
    gatewayUrl: 'wss://physicsedu.xyz',
    reconnectInterval: 1000,
    reconnectMaxMs: 8000,
    reconnectJitter: () => 0,
    now: () => 10000,
    setTimeoutImpl: (callback, delay) => { const timer = { callback, delay }; retryTimers.push(timer); return timer; },
    clearTimeoutImpl: () => {},
    WebSocketImpl: FakeWebSocket,
  });
  retryClient.connect();
  retryClient.ws.emit('close', 1006, 'network');
  assert.equal(retryTimers[0].delay, 1000, 'the first reconnect delay must use the bounded base delay');
  assert.equal(retryClient.getStatus().state, 'backoff');
  assert.equal(retryClient.getStatus().nextRetryAt, 11000);
  console.log('host WebSocket client lifecycle checks passed');
}

main().catch(error => { console.error(error); process.exit(1); });
