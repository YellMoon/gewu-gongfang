const assert = require('assert');
const { EventEmitter } = require('events');
const HostWebSocketClient = require('./client');

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;

  constructor() {
    super();
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
  hostToken: 'token-test',
  gatewayUrl: 'ws://localhost:3003',
  reconnectInterval: 1,
  WebSocketImpl: FakeWebSocket,
  });
  client.connect();
  client.disconnect();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.strictEqual(client.reconnectTimer, null, 'manual disconnect must not schedule a reconnect');
  assert.strictEqual(client.isConnected, false);
  console.log('host WebSocket client lifecycle checks passed');
}

main().catch(error => { console.error(error); process.exit(1); });
