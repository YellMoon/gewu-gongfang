const crypto = require('crypto');

function processorError(code) {
  return Object.assign(new Error(code), { code });
}

function createAuthorityHostCommandProcessor({
  targetHostId,
  commandSource,
  executor,
  claimLeaseMs = 30_000,
  batchLimit = 10,
  createClaimToken = () => crypto.randomUUID(),
} = {}) {
  const hostId = String(targetHostId || '').trim();
  if (!hostId) throw processorError('AUTHORITY_HOST_ID_REQUIRED');
  if (!commandSource || typeof commandSource.claim !== 'function'
    || typeof commandSource.renew !== 'function'
    || typeof commandSource.publishReceipt !== 'function') {
    throw processorError('AUTHORITY_COMMAND_SOURCE_REQUIRED');
  }
  if (!executor || typeof executor.execute !== 'function') {
    throw processorError('AUTHORITY_COMMAND_EXECUTOR_REQUIRED');
  }

  async function processOnce() {
    const claimToken = String(createClaimToken());
    const commands = await commandSource.claim({
      targetHostId: hostId,
      claimToken,
      leaseMs: claimLeaseMs,
      limit: batchLimit,
    });
    let processed = 0;
    let replayed = 0;
    let recovered = 0;
    for (const command of commands) {
      const result = await executor.execute(command.envelope);
      await commandSource.renew({
        commandId: command.commandId,
        claimToken,
        leaseMs: claimLeaseMs,
        sourceId: command.sourceId,
      });
      await commandSource.publishReceipt(result.receipt, {
        claimToken,
        sourceId: command.sourceId,
      });
      processed += 1;
      if (result.replayed) replayed += 1;
      if (command.recovered) recovered += 1;
    }
    return Object.freeze({ processed, replayed, recovered });
  }

  return Object.freeze({ processOnce });
}

module.exports = { createAuthorityHostCommandProcessor, processorError };
