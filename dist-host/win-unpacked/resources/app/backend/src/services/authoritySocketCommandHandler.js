const { validateEnvelope } = require('../../../shared/authorityProtocol');

const SOCKET_PROTOCOL = 'gewu.authority-socket.v1';

function handlerError(code, statusCode, retryable = false) {
  return Object.assign(new Error(code), { code, statusCode, retryable });
}

function normalizeHeaders(input = {}) {
  return Object.fromEntries(Object.entries(input || {}).map(([key, value]) => [
    String(key).toLowerCase(),
    String(value),
  ]));
}

function createAuthoritySocketCommandHandler({
  deviceAuth,
  authorizeCommand,
  inbox,
  worker,
  refreshControlRecords,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  pollIntervalMs = 50,
  maxPolls = 100,
} = {}) {
  if (typeof deviceAuth?.authenticate !== 'function'
    || typeof authorizeCommand !== 'function'
    || typeof inbox?.enqueue !== 'function'
    || typeof inbox?.findReceipt !== 'function'
    || typeof worker?.wake !== 'function') {
    throw handlerError('AUTHORITY_SOCKET_HANDLER_CONFIG_INVALID', 500);
  }

  async function process(frame) {
    if (!frame || frame.protocol !== SOCKET_PROTOCOL || frame.type !== 'command.submit'
      || typeof frame.requestId !== 'string' || !frame.requestId.trim()) {
      throw handlerError('AUTHORITY_SOCKET_FRAME_INVALID', 400);
    }
    const envelope = validateEnvelope(frame.envelope);
    if (typeof refreshControlRecords === 'function') {
      try { await refreshControlRecords(envelope); } catch (_error) { /* cached control records remain authoritative offline */ }
    }
    const request = {
      method: 'POST',
      originalUrl: '/api/authority/commands',
      url: '/api/authority/commands',
      headers: normalizeHeaders(frame.auth),
      body: envelope,
      params: {},
    };
    const actor = deviceAuth.authenticate(request);
    if (actor.userId !== envelope.actor.userId || actor.deviceId !== envelope.actor.deviceId
      || actor.role !== envelope.actor.role) {
      throw handlerError('AUTHORITY_ACTOR_MISMATCH', 403);
    }
    authorizeCommand(envelope);
    inbox.enqueue(envelope);
    await worker.wake();
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const receipt = inbox.findReceipt({ commandId: envelope.commandId, actor: envelope.actor });
      if (receipt) {
        return Object.freeze({
          protocol: SOCKET_PROTOCOL,
          type: 'command.receipt',
          requestId: frame.requestId,
          receipt,
        });
      }
      if (attempt + 1 < maxPolls) await sleep(pollIntervalMs);
    }
    throw handlerError('AUTHORITY_RECEIPT_PENDING', 503, true);
  }

  return Object.freeze({
    async handle(frame) {
      try {
        return await process(frame);
      } catch (error) {
        return Object.freeze({
          protocol: SOCKET_PROTOCOL,
          type: 'command.error',
          requestId: String(frame?.requestId || ''),
          error: Object.freeze({
            code: String(error?.code || 'AUTHORITY_SOCKET_REQUEST_FAILED'),
            retryable: error?.retryable === true,
          }),
        });
      }
    },
  });
}

module.exports = {
  SOCKET_PROTOCOL,
  createAuthoritySocketCommandHandler,
  handlerError,
};
