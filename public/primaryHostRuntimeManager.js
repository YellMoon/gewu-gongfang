const crypto = require('crypto');
const {
  generateRecoveryDeliveryKeyPair: defaultGenerateRecoveryDeliveryKeyPair,
  openRecoveryPackage: defaultOpenRecoveryPackage,
  signRecoveryDeliveryAcknowledgement: defaultSignRecoveryDeliveryAcknowledgement,
} = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol');

function runtimeError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function sameEpoch(left = {}, right = {}) {
  return String(left.id || left.epochId || '') === String(right.id || right.epochId || '')
    && Number(left.generation) === Number(right.generation)
    && String(left.deviceId || '') === String(right.deviceId || '')
    && String(left.userId || '') === String(right.userId || '');
}

function createPrimaryHostRuntimeManager({
  credentialStore,
  configPath,
  userDataPath,
  env = process.env,
  readRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  applyRuntimeConfigToEnv,
  verifyAdoption,
  acknowledgeDelivery,
  generateRecoveryDeliveryKeyPair = defaultGenerateRecoveryDeliveryKeyPair,
  openRecoveryPackage = defaultOpenRecoveryPackage,
  signRecoveryDeliveryAcknowledgement = defaultSignRecoveryDeliveryAcknowledgement,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
}) {
  if (!credentialStore || !configPath || !readRuntimeConfig
    || !writeManagedHostRuntimeConfig || !writeManagedClientRuntimeConfig
    || !applyRuntimeConfigToEnv) {
    throw runtimeError('PRIMARY_HOST_RUNTIME_MANAGER_CONFIG_REQUIRED');
  }
  const configOptions = { userDataPath };
  let lastState = null;

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw runtimeError('PRIMARY_HOST_CLOCK_INVALID');
    return date;
  }

  function failClosed(config, code) {
    const effectiveConfig = {
      ...config,
      nodeRole: 'desktop-client',
      primaryHostEpochId: '',
      primaryHostGeneration: null,
    };
    applyRuntimeConfigToEnv(effectiveConfig, env);
    delete env.GEWU_PRIMARY_HOST_CREDENTIAL;
    lastState = Object.freeze({
      config: Object.freeze(effectiveConfig),
      credential: Object.freeze({ state: 'error', active: false, code }),
    });
    return lastState;
  }

  function initialize() {
    const config = readRuntimeConfig(configPath, configOptions);
    let credential;
    try {
      credential = credentialStore.read();
    } catch (error) {
      return failClosed(config, error.code || 'PRIMARY_HOST_CREDENTIAL_UNREADABLE', error);
    }
    if (!credential) {
      if (config.primaryHostEpochId || config.primaryHostGeneration) {
        return failClosed(config, 'PRIMARY_HOST_CREDENTIAL_MISSING');
      }
      applyRuntimeConfigToEnv(config, env);
      delete env.GEWU_PRIMARY_HOST_CREDENTIAL;
      lastState = Object.freeze({ config, credential: credentialStore.status() });
      return lastState;
    }
    if (credential.state === 'staged') {
      const effectiveConfig = {
        ...config,
        nodeRole: 'desktop-client',
        primaryHostEpochId: '',
        primaryHostGeneration: null,
      };
      applyRuntimeConfigToEnv(effectiveConfig, env);
      delete env.GEWU_PRIMARY_HOST_CREDENTIAL;
      lastState = Object.freeze({ config: Object.freeze(effectiveConfig), credential: credentialStore.status() });
      return lastState;
    }
    if (credential.deviceId !== config.deviceId) {
      return failClosed(config, 'PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH');
    }
    let managedConfig;
    try {
      managedConfig = writeManagedHostRuntimeConfig(configPath, {
        deviceId: credential.deviceId,
        epochId: credential.epochId,
        generation: credential.generation,
      }, configOptions);
    } catch (error) {
      return failClosed(config, error.code || 'PRIMARY_HOST_RUNTIME_CONFIG_FAILED', error);
    }
    applyRuntimeConfigToEnv(managedConfig, env);
    env.GEWU_PRIMARY_HOST_CREDENTIAL = credential.credential;
    lastState = Object.freeze({ config: managedConfig, credential: credentialStore.status() });
    return lastState;
  }

  async function adopt(input = {}) {
    const config = readRuntimeConfig(configPath, configOptions);
    const epoch = input.epoch && typeof input.epoch === 'object' ? input.epoch : {};
    if (!epoch.deviceId || epoch.deviceId !== config.deviceId) {
      throw runtimeError('PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH');
    }
    if (typeof verifyAdoption !== 'function') {
      throw runtimeError('PRIMARY_HOST_ADOPTION_VERIFIER_REQUIRED');
    }
    if (Object.hasOwn(input, 'hostCredential')) {
      throw runtimeError('PRIMARY_HOST_PLAINTEXT_CREDENTIAL_FORBIDDEN');
    }
    const staged = credentialStore.read();
    if (!staged || staged.stageId !== String(input.credentialStageId || '')) {
      throw runtimeError('PRIMARY_HOST_CREDENTIAL_STAGE_REQUIRED');
    }
    if (staged.deviceId !== epoch.deviceId || staged.generation !== Number(epoch.generation)) {
      throw runtimeError('PRIMARY_HOST_CREDENTIAL_STAGE_MISMATCH');
    }
    const verified = await verifyAdoption({
      authorization: input.authorization,
      epoch,
      credential: staged.credential,
    });
    const verifiedEpoch = verified?.epoch;
    if (!verifiedEpoch || !sameEpoch(verifiedEpoch, epoch)) {
      throw runtimeError('PRIMARY_HOST_CREDENTIAL_ADOPTION_MISMATCH');
    }
    const delivery = input.recoveryDelivery && typeof input.recoveryDelivery === 'object'
      ? input.recoveryDelivery
      : {};
    const envelope = delivery.envelope;
    const stagedKey = staged.recoveryDeliveryKey;
    if (delivery.status !== 'pending' || !envelope || !stagedKey) {
      throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_PENDING');
    }
    if (!delivery.id || delivery.epochId !== verifiedEpoch.id
      || delivery.factorId !== envelope?.aad?.factorId
      || Number(delivery.generation) !== Number(verifiedEpoch.generation)
      || delivery.recipientKeyFingerprint !== stagedKey.publicKeyFingerprint
      || envelope?.aad?.epochId !== verifiedEpoch.id
      || envelope?.aad?.deviceId !== verifiedEpoch.deviceId
      || Number(envelope?.aad?.generation) !== Number(verifiedEpoch.generation)
      || envelope?.aad?.recipientKeyFingerprint !== stagedKey.publicKeyFingerprint) {
      throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
    let recoveryPackage;
    try {
      recoveryPackage = openRecoveryPackage({
        envelope,
        privateKeyPem: stagedKey.privateKeyPem,
        expected: {
          epochId: verifiedEpoch.id,
          factorId: delivery.factorId,
          deviceId: verifiedEpoch.deviceId,
          generation: verifiedEpoch.generation,
          recipientPublicKeyFingerprint: stagedKey.publicKeyFingerprint,
        },
      });
    } catch (cause) {
      throw runtimeError(cause?.code || 'PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED', cause);
    }
    if (recoveryPackage.epochId !== verifiedEpoch.id
      || recoveryPackage.factorId !== delivery.factorId
      || recoveryPackage.deviceId !== verifiedEpoch.deviceId
      || Number(recoveryPackage.generation) !== Number(verifiedEpoch.generation)) {
      throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
    const credential = credentialStore.commit({
      stageId: staged.stageId,
      epoch: verifiedEpoch,
      pendingRecoveryDelivery: {
        deliveryId: delivery.id,
        epochId: delivery.epochId,
        factorId: delivery.factorId,
        generation: delivery.generation,
        acknowledgementNonce: delivery.ackNonce,
        rowVersion: delivery.rowVersion,
        recipientPublicKeyFingerprint: delivery.recipientKeyFingerprint,
        recoveryPackage,
      },
    });
    const managedConfig = writeManagedHostRuntimeConfig(configPath, {
      deviceId: verifiedEpoch.deviceId,
      epochId: verifiedEpoch.id,
      generation: verifiedEpoch.generation,
    }, configOptions);
    const stored = credentialStore.read();
    applyRuntimeConfigToEnv(managedConfig, env);
    env.GEWU_PRIMARY_HOST_CREDENTIAL = stored.credential;
    lastState = Object.freeze({ config: managedConfig, credential });
    return Object.freeze({ ...credential, restartRequired: true });
  }

  function stageAdoption(input = {}) {
    const config = readRuntimeConfig(configPath, configOptions);
    const operation = String(input.operation || '').trim();
    const challengeId = String(input.challengeId || '').trim();
    const generation = Number(input.targetGeneration);
    if (!['bootstrap', 'transfer', 'recovery'].includes(operation)
      || !challengeId || challengeId.length > 128
      || !Number.isSafeInteger(generation) || generation < 1) {
      throw runtimeError('PRIMARY_HOST_CREDENTIAL_STAGE_INVALID');
    }
    const stageId = `${operation}:${challengeId}`;
    const existing = credentialStore.read();
    if (existing?.state === 'staged'
      && existing.stageId === stageId
      && existing.operation === operation
      && existing.deviceId === config.deviceId
      && existing.generation === generation) {
      return credentialStore.status();
    }
    const hostCredential = Buffer.from(randomBytes(32)).toString('base64url');
    if (hostCredential.length < 32) throw runtimeError('PRIMARY_HOST_CREDENTIAL_GENERATION_FAILED');
    const recoveryDeliveryKey = generateRecoveryDeliveryKeyPair();
    return credentialStore.stage({
      stageId,
      operation,
      deviceId: config.deviceId,
      targetGeneration: generation,
      hostCredential,
      recoveryDeliveryKey,
    });
  }

  function revealRecoveryPackage({ deliveryId } = {}) {
    return credentialStore.revealRecoveryPackage({ deliveryId });
  }

  async function acknowledgeRecoveryPackage({ authorization, deliveryId, expectedRowVersion } = {}) {
    if (typeof acknowledgeDelivery !== 'function') {
      throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_ACKNOWLEDGER_REQUIRED');
    }
    const stored = credentialStore.read();
    const pending = stored?.pendingRecoveryDelivery;
    if (!pending || pending.deliveryId !== String(deliveryId || '')) {
      throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
    if (Number(expectedRowVersion) !== pending.rowVersion) {
      throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT');
    }
    const acknowledgement = Object.freeze({
      deliveryId: pending.deliveryId,
      epochId: pending.epochId,
      factorId: pending.factorId,
      recipientKeyFingerprint: pending.recipientPublicKeyFingerprint,
      expectedRowVersion: pending.rowVersion,
      acknowledgementNonce: pending.acknowledgementNonce,
      acknowledgedAt: currentDate().toISOString(),
    });
    const signature = signRecoveryDeliveryAcknowledgement({
      acknowledgement,
      privateKeyPem: stored.recoveryDeliveryKey.privateKeyPem,
    });
    const remote = await acknowledgeDelivery({ authorization, acknowledgement, signature });
    const acknowledged = remote?.recoveryDelivery;
    if (acknowledged?.id !== pending.deliveryId
      || acknowledged.status !== 'acknowledged'
      || !Number.isSafeInteger(Number(acknowledged.rowVersion))
      || Number(acknowledged.rowVersion) <= pending.rowVersion) {
      throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_RESPONSE_INVALID');
    }
    const credential = credentialStore.clearRecoveryDelivery({ deliveryId: pending.deliveryId });
    const config = readRuntimeConfig(configPath, configOptions);
    lastState = Object.freeze({ config, credential });
    return Object.freeze({ ...credential, restartRequired: true });
  }

  function demote({ expectedEpochId } = {}) {
    const config = readRuntimeConfig(configPath, configOptions);
    const managedConfig = writeManagedClientRuntimeConfig(configPath, {
      deviceId: config.deviceId,
      expectedEpochId,
    }, configOptions);
    applyRuntimeConfigToEnv(managedConfig, env);
    delete env.GEWU_PRIMARY_HOST_CREDENTIAL;
    credentialStore.clear();
    lastState = Object.freeze({ config: managedConfig, credential: credentialStore.status() });
    return lastState;
  }

  return Object.freeze({
    initialize,
    stageAdoption,
    adopt,
    acknowledgeRecoveryPackage,
    demote,
    revealRecoveryPackage,
    status() {
      return lastState || initialize();
    },
  });
}

module.exports = { createPrimaryHostRuntimeManager };
