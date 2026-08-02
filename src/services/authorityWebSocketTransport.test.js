const assert = require('assert');
const EventEmitter = require('events');

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.emit('open');
    });
  }

  send(raw) {
    const frame = JSON.parse(raw);
    this.sent.push(frame);
    if (frame.type === 'connection.authenticate') {
      queueMicrotask(() => this.emit('message', JSON.stringify({
        protocol: 'gewu.authority-socket.v1',
        type: 'ready',
      })));
    } else if (frame.type === 'command.submit') {
      queueMicrotask(() => this.emit('message', JSON.stringify({
        protocol: 'gewu.authority-socket.v1',
        type: 'command.receipt',
        requestId: frame.requestId,
        receipt: {
          protocol: 'gewu.authority-receipt.v1',
          commandId: frame.envelope.commandId,
          payloadHash: frame.envelope.payloadHash,
          authorityId: frame.envelope.authorityId,
          hostEpochId: frame.envelope.hostEpochId,
          resultHash: 'result-hash-1',
          projectionVersion: 8,
        },
      })));
    }
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

(async function main() {
  const {
    createAuthorityWebSocketTransport,
    authorityWebSocketUrl,
  } = await import('./authorityWebSocketTransport.mjs');
  assert.strictEqual(
    authorityWebSocketUrl('https://physicsedu.xyz/scheduling'),
    'wss://physicsedu.xyz/scheduling/ws/authority',
    'the authority socket must stay inside the backend control-plane base path',
  );
  assert.strictEqual(
    authorityWebSocketUrl('wss://physicsedu.xyz/scheduling/ws/authority'),
    'wss://physicsedu.xyz/scheduling/ws/authority',
  );
  const envelope = Object.freeze({
    protocol: 'gewu.authority-command.v1',
    commandId: 'command-ws-1',
    idempotencyKey: 'key-ws-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: Object.freeze({ userId: 'user-1', deviceId: 'device-1', role: 'teacher' }),
    lease: Object.freeze({ id: 'lease-1', grantVersion: 1 }),
    type: 'schedule.update.v1',
    payload: Object.freeze({ id: 'schedule-1', changes: Object.freeze({ notes: 'same envelope' }) }),
    payloadHash: 'payload-hash-1',
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  const signingCalls = [];
  const transport = createAuthorityWebSocketTransport({
    name: 'lan',
    url: 'ws://192.168.31.8:3001/ws/authority',
    WebSocketImpl: FakeWebSocket,
    createRequestId: () => 'request-ws-1',
    signRequest: input => {
      signingCalls.push(input);
      return {
        headers: {
          'x-gewu-authority-user-id': 'user-1',
          'x-gewu-authority-device-id': 'device-1',
          'x-gewu-authority-role': 'teacher',
          'x-gewu-authority-id': 'authority-1',
          'x-gewu-device-signature': 'signature-1',
        },
      };
    },
    timeoutMs: 250,
  });

  assert.strictEqual(await transport.isReady(envelope), true);
  const receipt = await transport.submit(envelope);
  assert.strictEqual(receipt.commandId, envelope.commandId);
  assert.strictEqual(FakeWebSocket.instances.length, 1, 'capability and submit must share one socket');
  const authenticateFrame = FakeWebSocket.instances[0].sent[0];
  assert.strictEqual(authenticateFrame.protocol, 'gewu.authority-socket.v1');
  assert.strictEqual(authenticateFrame.type, 'connection.authenticate');
  assert.strictEqual(authenticateFrame.auth['x-gewu-authority-id'], 'authority-1');
  const submitFrame = FakeWebSocket.instances[0].sent[1];
  assert.strictEqual(submitFrame.protocol, 'gewu.authority-socket.v1');
  assert.strictEqual(submitFrame.type, 'command.submit');
  assert.strictEqual(submitFrame.requestId, 'request-ws-1');
  assert.deepStrictEqual(submitFrame.envelope, envelope,
    'the adapter must serialize the exact persisted envelope without changing its shape');
  assert.deepStrictEqual(submitFrame.auth, {
    'x-gewu-authority-user-id': 'user-1',
    'x-gewu-authority-device-id': 'device-1',
    'x-gewu-authority-role': 'teacher',
    'x-gewu-authority-id': 'authority-1',
    'x-gewu-device-signature': 'signature-1',
  });
  assert.deepStrictEqual(signingCalls, [{
    method: 'GET',
    path: '/ws/authority',
    body: null,
  }, {
    method: 'POST',
    path: '/api/authority/commands',
    body: envelope,
  }]);

  class ClosedWebSocket extends EventEmitter {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => this.emit('close'));
    }
    close() {}
  }
  const unavailable = createAuthorityWebSocketTransport({
    name: 'relay-websocket',
    url: 'wss://cloud.example/ws/authority',
    WebSocketImpl: ClosedWebSocket,
    signRequest: () => ({ headers: {} }),
    timeoutMs: 50,
  });
  assert.strictEqual(await unavailable.isReady(envelope), false);

  console.log('authority WebSocket transport tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
