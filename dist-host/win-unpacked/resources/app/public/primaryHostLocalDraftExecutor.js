const crypto = require('crypto');
const { PROTOCOL, stableJson, validateEnvelope } = require('../shared/authorityProtocol');

function primaryHostLocalDraftError(code) {
  return Object.assign(new Error(code), { code });
}

function createPrimaryHostLocalDraftExecutor({
  refreshControlRecords,
  hostAuthorityContext,
  authorityExecutor,
  projectionWorker,
}) {
  if (typeof refreshControlRecords !== 'function') throw primaryHostLocalDraftError('PRIMARY_HOST_CONTROL_REFRESH_REQUIRED');
  if (typeof hostAuthorityContext !== 'function') {
    throw primaryHostLocalDraftError('PRIMARY_HOST_AUTHORITY_CONTEXT_REQUIRED');
  }
  if (!authorityExecutor || typeof authorityExecutor.execute !== 'function') {
    throw primaryHostLocalDraftError('PRIMARY_HOST_AUTHORITY_EXECUTOR_REQUIRED');
  }

  return async draft => {
    if (!draft || typeof draft !== 'object' || typeof draft.type !== 'string' || !draft.type) {
      throw primaryHostLocalDraftError('PRIMARY_HOST_LOCAL_DRAFT_REQUIRED');
    }
    await refreshControlRecords();
    const context = await hostAuthorityContext();
    const payload = draft.payload && typeof draft.payload === 'object' && !Array.isArray(draft.payload)
      ? draft.payload
      : null;
    if (!payload) throw primaryHostLocalDraftError('AUTHORITY_DRAFT_INVALID');
    const envelope = validateEnvelope({
      protocol: PROTOCOL,
      commandId: draft.commandId || crypto.randomUUID(),
      idempotencyKey: draft.idempotencyKey || crypto.randomUUID(),
      authorityId: context?.authorityId,
      hostEpochId: context?.hostEpochId,
      actor: context?.actor,
      lease: context?.lease,
      type: draft.type,
      payload,
      payloadHash: crypto.createHash('sha256').update(stableJson(payload)).digest('hex'),
      createdAt: new Date().toISOString(),
    });
    const result = await authorityExecutor.execute(envelope);
    if (result?.receipt?.status === 'committed') void projectionWorker?.wake?.();
    return Object.freeze({ ...result, envelope });
  };
}

module.exports = { createPrimaryHostLocalDraftExecutor };
