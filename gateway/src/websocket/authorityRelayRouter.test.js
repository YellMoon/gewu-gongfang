const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createAuthorityRelayRouter,
} = require('./authorityRelayRouter');

(async function main() {
  const envelope = Object.freeze({
    commandId: 'command-relay-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: Object.freeze({ userId: 'user-1', deviceId: 'device-1', role: 'teacher' }),
  });
  const frame = Object.freeze({
    protocol: 'gewu.authority-socket.v1',
    type: 'command.submit',
    requestId: 'request-relay-1',
    envelope,
    auth: Object.freeze({ 'x-gewu-device-signature': 'signature-1' }),
  });
  const clientMessages = [];
  const forwards = [];
  const clientSocket = {
    send: raw => clientMessages.push(JSON.parse(raw)),
  };
  const router = createAuthorityRelayRouter({
    authenticateFrame: input => {
      assert.strictEqual(input, frame);
      return envelope.actor;
    },
    authorizeCommand: input => {
      assert.strictEqual(input, envelope);
      return { scope: { kind: 'teacher' } };
    },
    targetHostFor: input => {
      assert.strictEqual(input, envelope);
      return 'host-1';
    },
    sendToHost: (hostDeviceId, message) => {
      forwards.push({ hostDeviceId, message });
      return true;
    },
    createRelayId: () => 'relay-1',
    setTimeoutImpl: () => 7,
    clearTimeoutImpl: () => {},
  });
  await router.handleDesktopFrame(clientSocket, frame);
  assert.strictEqual(forwards.length, 1);
  assert.strictEqual(forwards[0].hostDeviceId, 'host-1');
  assert.strictEqual(forwards[0].message.type, 'authority_command_forward');
  assert.strictEqual(forwards[0].message.payload.frame, frame,
    'relay WebSocket must forward the exact signed frame without reshaping its envelope');

  const response = Object.freeze({
    protocol: 'gewu.authority-socket.v1',
    type: 'command.receipt',
    requestId: frame.requestId,
    receipt: Object.freeze({ commandId: envelope.commandId }),
  });
  assert.strictEqual(router.handleHostResult('host-other', {
    relayRequestId: 'relay-1',
    response,
  }), false, 'a different host cannot complete the pending relay');
  assert.strictEqual(router.handleHostResult('host-1', {
    relayRequestId: 'relay-1',
    response,
  }), true);
  assert.deepStrictEqual(clientMessages, [response]);

  const unavailableMessages = [];
  const unavailable = createAuthorityRelayRouter({
    authenticateFrame: () => envelope.actor,
    authorizeCommand: () => ({}),
    targetHostFor: () => 'host-offline',
    sendToHost: () => false,
    createRelayId: () => 'relay-offline',
  });
  await unavailable.handleDesktopFrame({
    send: raw => unavailableMessages.push(JSON.parse(raw)),
  }, frame);
  assert.strictEqual(unavailableMessages[0].error.code, 'AUTHORITY_RELAY_HOST_UNAVAILABLE');
  assert.strictEqual(unavailableMessages[0].error.retryable, true);

  const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(serverSource.includes("'/ws/authority'"));
  assert.ok(serverSource.includes('authorityRelayRouter.handleDesktopFrame'));
  assert.ok(serverSource.includes('authorityRelayRouter.handleHostResult'));

  console.log('authority relay WebSocket router tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
