function transportError(code) {
  return Object.assign(new Error(code), { code });
}

export function verifyAuthorityReceipt(envelope, receipt) {
  if (!receipt || receipt.protocol !== 'gewu.authority-receipt.v1'
    || receipt.commandId !== envelope?.commandId
    || receipt.payloadHash !== envelope?.payloadHash
    || receipt.authorityId !== envelope?.authorityId
    || receipt.hostEpochId !== envelope?.hostEpochId
    || !['committed', 'rejected'].includes(String(receipt.status || ''))
    || !receipt.resultHash
    || !Number.isSafeInteger(Number(receipt.projectionVersion))
    || Number(receipt.projectionVersion) < 0) {
    throw transportError('AUTHORITY_RECEIPT_MISMATCH');
  }
  return receipt;
}

export function createAuthorityTransportSelector({
  lanTransport,
  relayWebSocketTransport,
  durableRelayTransport,
} = {}) {
  const candidates = [lanTransport, relayWebSocketTransport, durableRelayTransport].filter(Boolean);

  async function submit(envelope) {
    const diagnostics = [];
    for (const transport of candidates) {
      let ready = false;
      try {
        ready = typeof transport.isReady === 'function'
          ? await transport.isReady(envelope)
          : false;
      } catch (error) {
        diagnostics.push({ name: transport.name || 'unknown', code: error?.code || 'TRANSPORT_CHECK_FAILED' });
        continue;
      }
      if (!ready) {
        diagnostics.push({ name: transport.name || 'unknown', code: 'TRANSPORT_UNAVAILABLE' });
        continue;
      }
      if (typeof transport.submit !== 'function') throw transportError('AUTHORITY_TRANSPORT_INVALID');
      let receipt;
      try {
        receipt = await transport.submit(envelope);
      } catch (error) {
        if (error?.retryable === true) {
          diagnostics.push({
            name: transport.name || 'unknown',
            code: error?.code || 'TRANSPORT_SUBMIT_FAILED',
          });
          continue;
        }
        throw error;
      }
      verifyAuthorityReceipt(envelope, receipt);
      return Object.freeze({
        receipt,
        transportUsed: String(transport.name || 'unknown'),
        diagnostics: Object.freeze(diagnostics),
      });
    }
    const error = transportError('HOST_TRANSPORT_UNAVAILABLE');
    error.diagnostics = diagnostics;
    throw error;
  }

  return Object.freeze({ submit });
}

export { transportError };
