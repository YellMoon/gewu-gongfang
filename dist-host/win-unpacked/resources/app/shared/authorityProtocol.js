const PROTOCOL = 'gewu.authority-command.v1';

function authorityProtocolError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value || {}));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEnvelope(input = {}) {
  if (!input || typeof input !== 'object' || input.protocol !== PROTOCOL) {
    throw authorityProtocolError('AUTHORITY_PROTOCOL_INVALID');
  }
  if (!nonEmpty(input.commandId) || !nonEmpty(input.idempotencyKey)
    || !nonEmpty(input.authorityId) || !nonEmpty(input.hostEpochId)
    || !nonEmpty(input.payloadHash) || !nonEmpty(input.createdAt)
    || !Number.isFinite(Date.parse(input.createdAt))) {
    throw authorityProtocolError('AUTHORITY_ENVELOPE_INVALID');
  }
  if (!nonEmpty(input.actor?.userId) || !nonEmpty(input.actor?.deviceId)
    || !nonEmpty(input.actor?.role) || !nonEmpty(input.lease?.id)
    || !Number.isSafeInteger(input.lease?.grantVersion) || input.lease.grantVersion < 1) {
    throw authorityProtocolError('AUTHORITY_ACTOR_OR_LEASE_REQUIRED');
  }
  if (!/^[a-z][a-z0-9_.-]*\.v[1-9][0-9]*$/.test(String(input.type || ''))) {
    throw authorityProtocolError('AUTHORITY_COMMAND_TYPE_INVALID');
  }
  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? { ...input.payload }
    : {};
  return Object.freeze({
    protocol: PROTOCOL,
    commandId: input.commandId.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    authorityId: input.authorityId.trim(),
    hostEpochId: input.hostEpochId.trim(),
    actor: Object.freeze({
      userId: input.actor.userId.trim(),
      deviceId: input.actor.deviceId.trim(),
      role: input.actor.role.trim(),
    }),
    lease: Object.freeze({ id: input.lease.id.trim(), grantVersion: input.lease.grantVersion }),
    type: String(input.type).trim(),
    payload: Object.freeze(payload),
    payloadHash: input.payloadHash.trim(),
    createdAt: new Date(input.createdAt).toISOString(),
  });
}

module.exports = { PROTOCOL, authorityProtocolError, stableJson, stableValue, validateEnvelope };
