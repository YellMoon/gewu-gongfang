const {
  ACK_SIGNATURE_ALGORITHM,
  CONTENT_ENCRYPTION_ALGORITHM,
  DELIVERY_PROTOCOL_VERSION,
  KEY_WRAP_ALGORITHM,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  validateRecoveryDeliveryPublicKey,
} = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol');
const { validatePrimaryHostSigningPublicKey } = require('./primaryHostSigningKey');

const MIN_OLD_HOST_UNREACHABLE_MS = 15 * 60 * 1000;

function operationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function positiveGeneration(value) {
  const generation = Number(value);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw operationError('PRIMARY_HOST_GENERATION_INVALID');
  }
  return generation;
}

function currentDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw operationError('PRIMARY_HOST_VALIDATION_CLOCK_INVALID');
  return date;
}

function readPreparedEvidence(localPrepared) {
  const evidence = localPrepared?.evidence || {};
  const backup = localPrepared?.localValidation?.backup || {};
  const localPreflight = localPrepared?.localValidation?.localPreflight;
  if (backup.authoritative !== true || !/^[a-f0-9]{64}$/i.test(String(backup.sha256 || ''))) {
    throw operationError('PRIMARY_HOST_BACKUP_NOT_AUTHORITATIVE');
  }
  if (!localPreflight || localPreflight.status !== 'ok'
    || !Number.isSafeInteger(Number(localPreflight.tablesChecked))
    || Number(localPreflight.tablesChecked) < 1) {
    throw operationError('PRIMARY_HOST_LOCAL_PREFLIGHT_FAILED');
  }
  return { evidence, backup, localPreflight };
}

function buildAuthorityManifest({ evidence, backup, localPreflight }) {
  return {
    backup,
    database: {
      dbInstanceDigest: evidence.dbInstanceDigest,
      schemaVersion: evidence.schemaVersion,
      dbAuthorityId: evidence.dbAuthorityId,
      quickCheck: evidence.quickCheck,
    },
    questionBank: {
      storeId: evidence.storeId,
      dbAuthorityId: evidence.dbAuthorityId,
      bindingStatus: 'active',
    },
    localPreflight,
  };
}

function normalizeCredentialStage(value, { deviceId, targetGeneration }) {
  const stage = value && typeof value === 'object' ? value : {};
  const id = String(stage.id || '').trim();
  const commitment = String(stage.commitment || '').trim().toLowerCase();
  if (!id || id.length > 256
    || String(stage.deviceId || '') !== String(deviceId || '')
    || Number(stage.targetGeneration) !== Number(targetGeneration)
    || !/^[a-f0-9]{64}$/.test(commitment)) {
    throw operationError('PRIMARY_HOST_CREDENTIAL_STAGE_INVALID');
  }
  return Object.freeze({
    id,
    deviceId: String(deviceId),
    targetGeneration: Number(targetGeneration),
    commitment,
    hostSigningKey: validatePrimaryHostSigningPublicKey(stage.hostSigningKey),
  });
}

function normalizeRecoveryDeliveryDescriptor(value) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID';
  if (value?.protocolVersion !== DELIVERY_PROTOCOL_VERSION) throw operationError(code);
  try {
    const key = validateRecoveryDeliveryPublicKey(value);
    return Object.freeze({
      protocolVersion: DELIVERY_PROTOCOL_VERSION,
      keyAlgorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
      keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
      contentEncryptionAlgorithm: CONTENT_ENCRYPTION_ALGORITHM,
      acknowledgementSignatureAlgorithm: ACK_SIGNATURE_ALGORITHM,
      recipientKeyFingerprint: key.publicKeyFingerprint,
    });
  } catch (_error) {
    throw operationError(code);
  }
}

function buildPrimaryHostOperationManifest(input = {}) {
  const operation = String(input.operation || '').trim();
  if (operation === 'bootstrap') {
    const targetGeneration = positiveGeneration(input.targetGeneration);
    if (targetGeneration !== 1) throw operationError('PRIMARY_HOST_GENERATION_INVALID');
    return {
      credentialStage: normalizeCredentialStage(input.credentialStage, {
        deviceId: input.deviceId,
        targetGeneration,
      }),
      recoveryDelivery: normalizeRecoveryDeliveryDescriptor(input.recoveryDeliveryKey),
    };
  }
  if (operation !== 'transfer' && operation !== 'recovery') {
    throw operationError('PRIMARY_HOST_OPERATION_INVALID');
  }

  const sourceGeneration = positiveGeneration(input.sourceGeneration);
  const targetGeneration = positiveGeneration(input.targetGeneration);
  if (targetGeneration !== sourceGeneration + 1) {
    throw operationError('PRIMARY_HOST_GENERATION_INVALID');
  }
  const now = currentDate(input.now);
  const checkedAt = now.toISOString();
  const { evidence, backup, localPreflight } = readPreparedEvidence(input.localPrepared);
  const authorityManifest = buildAuthorityManifest({
    evidence,
    backup,
    localPreflight,
  });
  authorityManifest.credentialStage = normalizeCredentialStage(input.credentialStage, {
    deviceId: input.deviceId,
    targetGeneration,
  });
  authorityManifest.recoveryDelivery = normalizeRecoveryDeliveryDescriptor(input.recoveryDeliveryKey);

  if (operation === 'transfer') {
    const transferIdentity = {
      id: String(input.transferId || ''),
      sourceEpochId: String(input.sourceEpochId || ''),
      challengeId: String(input.challengeId || ''),
      targetDeviceId: String(input.deviceId || ''),
      sourceGeneration,
      targetGeneration,
    };
    const matchingTransfer = (input.controlStatus?.transfers || []).find(transfer => (
      transfer?.status === 'pending_validation'
      && String(transfer.id || '') === transferIdentity.id
      && String(transfer.sourceEpochId || '') === transferIdentity.sourceEpochId
      && String(transfer.challengeId || '') === transferIdentity.challengeId
      && String(transfer.targetDeviceId || '') === transferIdentity.targetDeviceId
      && Number(transfer.sourceGeneration) === sourceGeneration
      && Number(transfer.targetGeneration) === targetGeneration
    ));
    if (!matchingTransfer) throw operationError('PRIMARY_HOST_PENDING_TRANSFER_MISMATCH');
    return { ...authorityManifest, transfer: transferIdentity };
  }

  const activeEpoch = input.controlStatus?.activeEpoch || {};
  const heartbeat = activeEpoch.heartbeat || {};
  const heartbeatAt = Date.parse(String(heartbeat.updatedAt || ''));
  const durationMs = now.getTime() - heartbeatAt;
  const consecutiveFailures = Number(heartbeat.consecutiveFailures)
    || Math.floor(durationMs / (5 * 60 * 1000));
  if (heartbeat.status !== 'offline'
    || Number(activeEpoch.generation) !== sourceGeneration
    || !Number.isFinite(heartbeatAt)
    || durationMs < MIN_OLD_HOST_UNREACHABLE_MS
    || consecutiveFailures < 3) {
    throw operationError('PRIMARY_HOST_OLD_HOST_STILL_REACHABLE');
  }
  const { backup: _backup, ...recoveryManifest } = authorityManifest;
  return {
    ...recoveryManifest,
    authoritativeBackup: backup,
    oldHostUnreachable: {
      generation: sourceGeneration,
      consecutiveFailures,
      durationMs,
      observedAt: checkedAt,
    },
  };
}

module.exports = { buildPrimaryHostOperationManifest };
