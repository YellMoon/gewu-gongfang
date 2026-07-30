const assert = require('assert');

(async function main() {
  const {
    createAuthorityTransportSelector,
    verifyAuthorityReceipt,
  } = await import('./authorityTransports.mjs');
  const envelope = Object.freeze({
    commandId: 'command-1',
    payloadHash: 'payload-hash-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  const receipt = Object.freeze({
    protocol: 'gewu.authority-receipt.v1',
    commandId: 'command-1',
    payloadHash: 'payload-hash-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    status: 'committed',
    resultHash: 'result-hash-1',
    projectionVersion: 1,
  });
  const calls = [];
  const selector = createAuthorityTransportSelector({
    lanTransport: {
      name: 'lan',
      isReady: async () => false,
      submit: async () => { throw new Error('must not submit'); },
    },
    relayWebSocketTransport: {
      name: 'relay-websocket',
      isReady: async () => true,
      submit: async value => {
        calls.push(value);
        return receipt;
      },
    },
    durableRelayTransport: {
      name: 'durable-relay',
      isReady: async () => true,
      submit: async () => { throw new Error('must not submit'); },
    },
  });

  const delivered = await selector.submit(envelope);
  assert.strictEqual(delivered.transportUsed, 'relay-websocket');
  assert.strictEqual(calls[0], envelope, 'transport adapters must receive the identical envelope');
  assert.deepStrictEqual(delivered.receipt, receipt);
  assert.deepStrictEqual(verifyAuthorityReceipt(envelope, receipt), receipt);
  assert.throws(
    () => verifyAuthorityReceipt(envelope, { ...receipt, payloadHash: 'different-hash' }),
    error => error?.code === 'AUTHORITY_RECEIPT_MISMATCH'
  );

  const unavailable = createAuthorityTransportSelector({
    lanTransport: { name: 'lan', isReady: async () => false },
    relayWebSocketTransport: { name: 'relay-websocket', isReady: async () => false },
    durableRelayTransport: { name: 'durable-relay', isReady: async () => false },
  });
  await assert.rejects(
    () => unavailable.submit(envelope),
    error => error?.code === 'HOST_TRANSPORT_UNAVAILABLE'
  );

  const fallbackCalls = [];
  const retryableFallback = createAuthorityTransportSelector({
    lanTransport: {
      name: 'lan',
      isReady: async () => true,
      submit: async () => {
        fallbackCalls.push('lan');
        const error = new Error('socket closed');
        error.code = 'AUTHORITY_SOCKET_UNAVAILABLE';
        error.retryable = true;
        throw error;
      },
    },
    relayWebSocketTransport: {
      name: 'relay-websocket',
      isReady: async () => true,
      submit: async () => {
        fallbackCalls.push('relay-websocket');
        return receipt;
      },
    },
  });
  const fallback = await retryableFallback.submit(envelope);
  assert.strictEqual(fallback.transportUsed, 'relay-websocket');
  assert.deepStrictEqual(fallbackCalls, ['lan', 'relay-websocket']);
  assert.deepStrictEqual(fallback.diagnostics, [{
    name: 'lan',
    code: 'AUTHORITY_SOCKET_UNAVAILABLE',
  }]);

  const durableCalls = [];
  const durableFallback = createAuthorityTransportSelector({
    lanTransport: { name: 'lan-websocket', isReady: async () => false },
    relayWebSocketTransport: { name: 'relay-websocket', isReady: async () => false },
    durableRelayTransport: {
      name: 'durable-relay',
      isReady: async () => true,
      submit: async value => {
        durableCalls.push(value);
        return receipt;
      },
    },
  });
  const durableDelivered = await durableFallback.submit(envelope);
  assert.strictEqual(durableDelivered.transportUsed, 'durable-relay');
  assert.deepStrictEqual(durableCalls, [envelope]);
  assert.deepStrictEqual(durableDelivered.diagnostics, [
    { name: 'lan-websocket', code: 'TRANSPORT_UNAVAILABLE' },
    { name: 'relay-websocket', code: 'TRANSPORT_UNAVAILABLE' },
  ]);

  console.log('authority transport tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
