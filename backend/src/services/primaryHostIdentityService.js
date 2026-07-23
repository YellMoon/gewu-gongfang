const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  CANONICAL_SUPER_ADMIN_ID,
  SUPER_ADMIN_PHONE,
  normalizePhone,
} = require('./authorizationPolicy');
const { inspectQuestionBankStore } = require('./questionBankStorageService');
const { createHostRecoveryFactorService } = require('./hostRecoveryFactorService');
const {
  createPrimaryHostRecoveryDeliveryService,
} = require('./primaryHostRecoveryDeliveryService');
const { createPrimaryHostPreflightProofService } = require('./primaryHostPreflightProofService');
const {
  OPERATIONS,
  PHYSICAL_CONFIRMATION,
  RECEIPT_TTL_MS,
  normalizePrimaryHostLocalReceipt,
  primaryHostOperationManifestHash,
  verifyPrimaryHostLocalReceiptSignature,
} = require('./primaryHostReceiptProtocol');

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MIN_UNREACHABLE_DURATION_MS = 15 * 60 * 1000;
const DEFAULT_HOST_HEARTBEAT_TTL_MS = 5 * 60 * 1000;

function hostError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiredText(value, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw hostError(code);
  return normalized;
}

function safeInteger(value, code, minimum = 1) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) throw hostError(code);
  return normalized;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeHashEqual(raw, expectedHash) {
  const actual = Buffer.from(sha256(raw), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === 32 && expected.length === 32 && crypto.timingSafeEqual(actual, expected);
}

function approvedUser(row) {
  return Boolean(row)
    && row.deleted !== 1
    && row.status !== 0
    && row.login_enabled !== 0
    && row.review_status === 'approved';
}

function insertPrimaryHostEpochRow({
  db,
  id,
  generation,
  deviceId,
  userId,
  authorizationId,
  status = 'active',
  activationReason,
  sourceEpochId = null,
  challengeId,
  dbInstanceDigest,
  schemaVersion,
  storeId,
  dbAuthorityId,
  credentialHash,
  credentialVersion = 1,
  timestamp,
}) {
  db.prepare(`INSERT INTO primary_host_epochs
    (id, generation, device_id, user_id, authorization_id, status, activation_reason,
     source_epoch_id, challenge_id, db_instance_digest, schema_version, store_id,
     db_authority_id, host_credential_hash, credential_version, row_version,
     created_at, updated_at, activated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(
      id, generation, deviceId, userId, authorizationId, status, activationReason,
      sourceEpochId, challengeId, dbInstanceDigest, schemaVersion, storeId, dbAuthorityId,
      credentialHash, credentialVersion, timestamp, timestamp, timestamp
    );
  return db.prepare('SELECT * FROM primary_host_epochs WHERE id=?').get(id);
}

function presentChallenge(row) {
  return Object.freeze({
    id: row.id,
    operation: row.operation,
    requestedByUserId: row.requested_by_user_id,
    requestedByDeviceId: row.requested_by_device_id,
    targetDeviceId: row.target_device_id,
    status: row.status,
    verifiedUserId: row.verified_user_id || null,
    phoneVerifiedAt: row.phone_verified_at || null,
    rowVersion: Number(row.row_version),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    consumedAt: row.consumed_at || null,
  });
}

function presentEpoch(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    generation: Number(row.generation),
    deviceId: row.device_id,
    userId: row.user_id,
    authorizationId: row.authorization_id,
    status: row.status,
    activationReason: row.activation_reason,
    sourceEpochId: row.source_epoch_id || null,
    challengeId: row.challenge_id,
    dbInstanceDigest: row.db_instance_digest,
    schemaVersion: Number(row.schema_version),
    storeId: row.store_id,
    dbAuthorityId: row.db_authority_id,
    credentialVersion: Number(row.credential_version),
    rowVersion: Number(row.row_version),
    activatedAt: row.activated_at,
    retiredAt: row.retired_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function presentTransfer(row) {
  return Object.freeze({
    id: row.id,
    sourceEpochId: row.source_epoch_id,
    sourceGeneration: Number(row.source_generation),
    targetGeneration: Number(row.target_generation),
    targetDeviceId: row.target_device_id,
    userId: row.user_id,
    challengeId: row.challenge_id,
    status: row.status,
    validationManifestHash: row.validation_manifest_hash || null,
    lastFailureCode: row.last_failure_code || null,
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at || null,
  });
}

function defaultLocalEvidenceProvider(db) {
  return function (input = {}) {
    const runtimeNodeRole = input.bootstrapCandidateVerified === true
      ? 'primary-host'
      : process.env.GEWU_NODE_ROLE || 'desktop-client';
    const authority = db.prepare(
      "SELECT value FROM authority_metadata WHERE key='database_authority_id'"
    ).get();
    const binding = db.prepare(
      "SELECT * FROM question_bank_store_bindings WHERE status='active' ORDER BY bound_at DESC LIMIT 1"
    ).get();
    if (!authority?.value || !binding) {
      return {
        runtimeNodeRole,
        dbInstanceDigest: '',
        schemaVersion: Number(db.pragma('user_version', { simple: true }) || 0),
        storeId: '',
        dbAuthorityId: '',
        quickCheck: String(db.pragma('quick_check', { simple: true }) || ''),
      };
    }
    const inspected = inspectQuestionBankStore(binding.root_path);
    const storeMatches = inspected.available
      && inspected.manifest?.storeId === binding.store_id
      && inspected.manifest?.authorityDatabaseId === binding.db_authority_id
      && binding.db_authority_id === authority.value;
    const schemaVersion = Number(db.pragma('user_version', { simple: true }) || 0);
    return {
      runtimeNodeRole,
      dbInstanceDigest: storeMatches
        ? sha256(JSON.stringify([authority.value, schemaVersion, binding.store_id]))
        : '',
      schemaVersion,
      storeId: storeMatches ? binding.store_id : '',
      dbAuthorityId: storeMatches ? binding.db_authority_id : '',
      quickCheck: String(db.pragma('quick_check', { simple: true }) || ''),
    };
  };
}

function createPrimaryHostIdentityService({
  db,
  now = () => new Date(),
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
  localEvidenceProvider,
  recoveryFactorService,
  recoveryDeliveryService,
  preflightProofService,
  hostHeartbeatTtlMs = process.env.GEWU_HOST_HEARTBEAT_TTL_MS,
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw hostError('PRIMARY_HOST_DB_REQUIRED');
  const evidenceProvider = localEvidenceProvider || defaultLocalEvidenceProvider(db);
  const recoveryFactors = recoveryFactorService || createHostRecoveryFactorService({ db, now, uuid, randomBytes });
  const recoveryDeliveries = recoveryDeliveryService || createPrimaryHostRecoveryDeliveryService({
    db, now, uuid, randomBytes,
  });
  const preflightProofs = preflightProofService || createPrimaryHostPreflightProofService({
    db, now, uuid, randomBytes,
  });

  const findChallenge = db.prepare('SELECT * FROM primary_host_operation_challenges WHERE id=?');
  const findActiveEpoch = db.prepare("SELECT * FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1");
  const findAuthorization = db.prepare('SELECT * FROM desktop_device_authorizations WHERE device_id=?');
  const findUser = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0');
  const findHostHeartbeat = db.prepare(`SELECT status, updated_at
    FROM host_heartbeats WHERE host_device_id=? ORDER BY updated_at DESC LIMIT 1`);
  const heartbeatTtlMs = Math.max(1000, Number(hostHeartbeatTtlMs) || DEFAULT_HOST_HEARTBEAT_TTL_MS);

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw hostError('PRIMARY_HOST_CLOCK_INVALID');
    return date;
  }

  function canonicalSuperAdmin(userId) {
    const user = findUser.get(userId);
    if (!approvedUser(user)) throw hostError('PRIMARY_HOST_CANONICAL_SUPER_ADMIN_REQUIRED');
    const canonical = user.id === CANONICAL_SUPER_ADMIN_ID
      || (user.is_super_admin_identity === 1 && normalizePhone(user.phone) === SUPER_ADMIN_PHONE);
    const grant = db.prepare(`SELECT 1 FROM user_role_grants
      WHERE user_id=? AND role='super_admin' AND status='active'`).get(user.id);
    if (!canonical || !grant) throw hostError('PRIMARY_HOST_CANONICAL_SUPER_ADMIN_REQUIRED');
    return user;
  }

  function assertActor(context = {}) {
    const userId = requiredText(context.userId, 'PRIMARY_HOST_OWNER_REQUIRED');
    const deviceId = requiredText(context.deviceId, 'PRIMARY_HOST_DEVICE_REQUIRED');
    if (context.activeRole !== 'super_admin'
      || !Array.isArray(context.eligibleRoles)
      || !context.eligibleRoles.includes('super_admin')) {
      throw hostError('PRIMARY_HOST_SUPER_ADMIN_ROLE_REQUIRED');
    }
    const user = canonicalSuperAdmin(userId);
    const authorization = findAuthorization.get(deviceId);
    if (!authorization || authorization.status !== 'active') throw hostError('PRIMARY_HOST_DEVICE_NOT_ACTIVE');
    if (authorization.user_id !== userId || context.deviceOwnerUserId && context.deviceOwnerUserId !== userId) {
      throw hostError('PRIMARY_HOST_DEVICE_OWNER_MISMATCH');
    }
    if (context.authorizationId && context.authorizationId !== authorization.id) {
      throw hostError('PRIMARY_HOST_DEVICE_AUTHORIZATION_MISMATCH');
    }
    if (context.credentialVersion
      && Number(context.credentialVersion) !== Number(authorization.credential_version)) {
      throw hostError('PRIMARY_HOST_DEVICE_CREDENTIAL_MISMATCH');
    }
    return { user, authorization, userId, deviceId };
  }

  function expireChallenge(row, current) {
    if (row && ['pending_phone', 'identity_verified'].includes(row.status)
      && Date.parse(row.expires_at) <= current.getTime()) {
      db.prepare(`UPDATE primary_host_operation_challenges
        SET status='expired', row_version=row_version+1, updated_at=?
        WHERE id=? AND row_version=?`)
        .run(current.toISOString(), row.id, row.row_version);
      return findChallenge.get(row.id);
    }
    return row;
  }

  function getActiveEpochRow() {
    return findActiveEpoch.get() || null;
  }

  function getActiveEpoch() {
    return presentEpoch(getActiveEpochRow());
  }

  function assertSameOwnerTarget(targetDeviceId, userId) {
    const target = findAuthorization.get(targetDeviceId);
    if (!target || target.status !== 'active') throw hostError('PRIMARY_HOST_TARGET_DEVICE_NOT_ACTIVE');
    if (target.user_id !== userId) throw hostError('PRIMARY_HOST_TARGET_OWNER_MISMATCH');
    return target;
  }

  function startOperationChallenge(input = {}) {
    const actor = assertActor(input.actorContext);
    const operation = requiredText(input.operation, 'PRIMARY_HOST_OPERATION_REQUIRED');
    if (!OPERATIONS.has(operation)) throw hostError('PRIMARY_HOST_OPERATION_INVALID');
    assertNoPendingRecoveryDelivery(actor.userId);
    const targetDeviceId = requiredText(input.targetDeviceId || actor.deviceId, 'PRIMARY_HOST_TARGET_DEVICE_REQUIRED');
    const active = getActiveEpochRow();
    if (operation === 'bootstrap') {
      if (active) throw hostError('PRIMARY_HOST_ALREADY_BOOTSTRAPPED');
      if (targetDeviceId !== actor.deviceId) throw hostError('PRIMARY_HOST_BOOTSTRAP_DEVICE_MISMATCH');
    } else {
      if (!active) throw hostError('PRIMARY_HOST_NOT_BOOTSTRAPPED');
      if (active.user_id !== actor.userId) throw hostError('PRIMARY_HOST_OWNER_MISMATCH');
      if (operation === 'transfer' && active.device_id !== actor.deviceId) {
        throw hostError('PRIMARY_HOST_ACTIVE_DEVICE_REQUIRED');
      }
      if (targetDeviceId === active.device_id) throw hostError('PRIMARY_HOST_TARGET_DEVICE_UNCHANGED');
    }
    assertSameOwnerTarget(targetDeviceId, actor.userId);
    const current = currentDate();
    let existing = db.prepare(`SELECT * FROM primary_host_operation_challenges
      WHERE operation=? AND requested_by_user_id=? AND target_device_id=?
        AND status IN ('pending_phone','identity_verified')`).get(operation, actor.userId, targetDeviceId);
    existing = expireChallenge(existing, current);
    if (existing && ['pending_phone', 'identity_verified'].includes(existing.status)) {
      return presentChallenge(existing);
    }
    const id = requiredText(uuid(), 'PRIMARY_HOST_CHALLENGE_ID_INVALID');
    const timestamp = current.toISOString();
    const expiresAt = new Date(current.getTime() + CHALLENGE_TTL_MS).toISOString();
    db.prepare(`INSERT INTO primary_host_operation_challenges
      (id, operation, requested_by_user_id, requested_by_device_id, target_device_id,
       status, expires_at, row_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending_phone', ?, 1, ?, ?)`)
      .run(id, operation, actor.userId, actor.deviceId, targetDeviceId, expiresAt, timestamp, timestamp);
    return presentChallenge(findChallenge.get(id));
  }

  function readOperationChallenge(challengeId) {
    const id = requiredText(challengeId, 'PRIMARY_HOST_CHALLENGE_REQUIRED');
    const row = expireChallenge(findChallenge.get(id), currentDate());
    if (!row) throw hostError('PRIMARY_HOST_CHALLENGE_NOT_FOUND');
    return presentChallenge(row);
  }

  function readPublicOperationChallenge(challengeId) {
    const challenge = readOperationChallenge(challengeId);
    const authorization = findAuthorization.get(challenge.targetDeviceId);
    return Object.freeze({
      id: challenge.id,
      deviceName: authorization?.device_name || 'Unknown device',
      keyFingerprintSummary: authorization?.key_fingerprint
        ? `${authorization.key_fingerprint.slice(0, 8)}…${authorization.key_fingerprint.slice(-4)}`
        : 'Unavailable',
      operation: challenge.operation,
      purpose: `primary-host-${challenge.operation}`,
      status: challenge.status,
      rowVersion: challenge.rowVersion,
      expiresAt: challenge.expiresAt,
      createdAt: challenge.createdAt,
    });
  }

  function confirmOperationChallenge(input = {}) {
    const challengeId = requiredText(input.challengeId, 'PRIMARY_HOST_CHALLENGE_REQUIRED');
    const current = currentDate();
    const row = expireChallenge(findChallenge.get(challengeId), current);
    if (!row) throw hostError('PRIMARY_HOST_CHALLENGE_NOT_FOUND');
    if (row.status !== 'pending_phone') {
      throw hostError(row.status === 'identity_verified'
        ? 'PRIMARY_HOST_CHALLENGE_ALREADY_VERIFIED'
        : 'PRIMARY_HOST_CHALLENGE_STATE_INVALID');
    }
    if (Number(row.row_version) !== Number(input.expectedRowVersion)) {
      throw hostError('PRIMARY_HOST_CHALLENGE_VERSION_MISMATCH');
    }
    const identityId = requiredText(input.identity?.id, 'PRIMARY_HOST_PHONE_PROOF_REQUIRED');
    if (identityId !== row.requested_by_user_id) throw hostError('PRIMARY_HOST_PHONE_IDENTITY_MISMATCH');
    const user = canonicalSuperAdmin(identityId);
    const loginEventId = requiredText(input.loginEventId, 'PRIMARY_HOST_PHONE_PROOF_REQUIRED');
    const loginEvent = db.prepare('SELECT * FROM miniapp_login_events WHERE id=?').get(loginEventId);
    if (!loginEvent || loginEvent.user_id !== identityId
      || loginEvent.result_code !== 'FORMAL_LOGIN_SUCCESS'
      || normalizePhone(loginEvent.phone_normalized) !== normalizePhone(user.phone)
      || Date.parse(loginEvent.created_at) < Date.parse(row.created_at) - 30000
      || Date.parse(loginEvent.created_at) > current.getTime() + 30000) {
      throw hostError('PRIMARY_HOST_PHONE_PROOF_INVALID');
    }
    const timestamp = current.toISOString();
    const updated = db.prepare(`UPDATE primary_host_operation_challenges
      SET status='identity_verified', verified_user_id=?, verified_login_event_id=?,
          phone_verified_at=?, row_version=row_version+1, updated_at=?
      WHERE id=? AND status='pending_phone' AND row_version=?`)
      .run(identityId, loginEventId, timestamp, timestamp, row.id, row.row_version);
    if (updated.changes !== 1) throw hostError('PRIMARY_HOST_CHALLENGE_VERSION_MISMATCH');
    return presentChallenge(findChallenge.get(row.id));
  }

  function collectLocalEvidence(input = {}) {
    const evidence = evidenceProvider({
      deviceId: input.deviceId || process.env.GEWU_DEVICE_ID || '',
      purpose: input.purpose,
    }) || {};
    if (input.purpose === 'bootstrap' && evidence.runtimeNodeRole !== 'primary-host') {
      throw hostError('PRIMARY_HOST_RUNTIME_ROLE_REQUIRED');
    }
    if (!/^[a-f0-9]{64}$/i.test(String(evidence.dbInstanceDigest || ''))) {
      throw hostError('PRIMARY_HOST_DB_DIGEST_REQUIRED');
    }
    if (!Number.isSafeInteger(Number(evidence.schemaVersion)) || Number(evidence.schemaVersion) < 1) {
      throw hostError('PRIMARY_HOST_SCHEMA_EVIDENCE_REQUIRED');
    }
    if (!String(evidence.storeId || '').trim() || !String(evidence.dbAuthorityId || '').trim()) {
      throw hostError('PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED');
    }
    if (evidence.quickCheck !== 'ok') throw hostError('PRIMARY_HOST_SQLITE_QUICK_CHECK_FAILED');
    return evidence;
  }

  function verifyLocalReceipt(value, { challenge, actor, purpose }) {
    if (!value?.signature || !value?.receipt) throw hostError('PRIMARY_HOST_LOCAL_RECEIPT_INVALID');
    const receipt = normalizePrimaryHostLocalReceipt(value.receipt);
    verifyPrimaryHostLocalReceiptSignature({
      receipt,
      signature: value.signature,
      publicKey: actor.authorization.public_key,
    });
    const current = currentDate().getTime();
    if (Date.parse(receipt.issuedAt) > current + 30000 || Date.parse(receipt.expiresAt) <= current
      || Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt) > RECEIPT_TTL_MS) {
      throw hostError('PRIMARY_HOST_LOCAL_RECEIPT_EXPIRED');
    }
    if (receipt.operation !== purpose || receipt.challengeId !== challenge.id
      || receipt.userId !== actor.userId || receipt.deviceId !== actor.deviceId
      || receipt.authorizationId !== actor.authorization.id
      || receipt.credentialVersion !== Number(actor.authorization.credential_version)
      || challenge.requested_by_user_id !== actor.userId
      || challenge.target_device_id !== actor.deviceId) {
      throw hostError('PRIMARY_HOST_LOCAL_RECEIPT_CONTEXT_MISMATCH');
    }
    return receipt;
  }

  function assertReceiptManifest(receipt, operationManifest) {
    const expectedHash = primaryHostOperationManifestHash(operationManifest);
    if (receipt.operationManifestHash !== expectedHash) {
      throw hostError('PRIMARY_HOST_OPERATION_MANIFEST_ATTESTATION_MISMATCH');
    }
  }

  function assertVerifiedChallenge({ challengeId, operation, actor, expectedRowVersion }) {
    const row = expireChallenge(findChallenge.get(challengeId), currentDate());
    if (!row) throw hostError('PRIMARY_HOST_CHALLENGE_NOT_FOUND');
    if (row.status === 'consumed') throw hostError('PRIMARY_HOST_CHALLENGE_REPLAYED');
    if (row.status !== 'identity_verified') throw hostError('PRIMARY_HOST_PHONE_PROOF_REQUIRED');
    if (row.operation !== operation || row.requested_by_user_id !== actor.userId) {
      throw hostError('PRIMARY_HOST_CHALLENGE_CONTEXT_MISMATCH');
    }
    if (Number(row.row_version) !== Number(expectedRowVersion)) {
      throw hostError('PRIMARY_HOST_CHALLENGE_VERSION_MISMATCH');
    }
    return row;
  }

  function assertCredentialStage(value, { actor, generation }) {
    const stage = value && typeof value === 'object' ? value : {};
    const commitment = String(stage.commitment || '').trim().toLowerCase();
    if (!String(stage.id || '').trim() || String(stage.id).length > 256
      || stage.deviceId !== actor.deviceId
      || Number(stage.targetGeneration) !== Number(generation)
      || !/^[a-f0-9]{64}$/.test(commitment)) {
      throw hostError('PRIMARY_HOST_CREDENTIAL_STAGE_INVALID');
    }
    return Object.freeze({ commitment });
  }

  function prepareEpochSecrets({
    epochId,
    userId,
    deviceId,
    generation,
    credentialStage,
    recoveryDeliveryKey,
    operationManifest,
    actor,
  }) {
    const staged = assertCredentialStage(credentialStage, { actor, generation });
    if (!recoveryDeliveryKey) throw hostError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED');
    const recovery = recoveryFactors.prepare({ epochId, userId, deviceId, generation });
    const delivery = recoveryDeliveries.prepare({
      epochId,
      factorId: recovery.recoveryPackage.factorId,
      userId,
      deviceId,
      generation,
      recoveryPackage: recovery.recoveryPackage,
      deliveryKey: recoveryDeliveryKey,
      recoveryDeliveryDescriptor: operationManifest?.recoveryDelivery,
    });
    return { hostCredentialHash: staged.commitment, recovery, delivery };
  }

  function insertEpoch({
    id, generation, actor, status = 'active', activationReason, sourceEpochId = null,
    challenge, receipt, credentialHash, credentialVersion = 1, timestamp,
  }) {
    insertPrimaryHostEpochRow({
      db,
      id,
      generation,
      deviceId: actor.deviceId,
      userId: actor.userId,
      authorizationId: actor.authorization.id,
      status,
      activationReason,
      sourceEpochId,
      challengeId: challenge.id,
      dbInstanceDigest: receipt.dbInstanceDigest,
      schemaVersion: receipt.schemaVersion,
      storeId: receipt.storeId,
      dbAuthorityId: receipt.dbAuthorityId,
      credentialHash,
      credentialVersion,
      timestamp,
    });
  }

  function consumeChallenge(challenge, timestamp) {
    const result = db.prepare(`UPDATE primary_host_operation_challenges
      SET status='consumed', consumed_at=?, row_version=row_version+1, updated_at=?
      WHERE id=? AND status='identity_verified' AND row_version=?`)
      .run(timestamp, timestamp, challenge.id, challenge.row_version);
    if (result.changes !== 1) throw hostError('PRIMARY_HOST_CHALLENGE_VERSION_MISMATCH');
  }

  function recoveryDeliveryForEpoch({ epochId, actor, required = true }) {
    try {
      return recoveryDeliveries.getTargetDelivery({
        epochId,
        userId: actor.userId,
        deviceId: actor.deviceId,
      });
    } catch (error) {
      if (!required && error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND') return null;
      throw error;
    }
  }

  function presentActivatedResult({ epochRow, actor, extra = {}, deliveryRequired = true }) {
    const result = { epoch: presentEpoch(epochRow), ...extra };
    const recoveryDelivery = recoveryDeliveryForEpoch({
      epochId: epochRow.id,
      actor,
      required: deliveryRequired,
    });
    if (recoveryDelivery) result.recoveryDelivery = recoveryDelivery;
    return Object.freeze(result);
  }

  function assertNoPendingRecoveryDelivery(userId) {
    if (recoveryDeliveries.hasPendingForUser(userId)) {
      throw hostError('PRIMARY_HOST_RECOVERY_DELIVERY_PENDING');
    }
  }

  function bootstrap(input = {}) {
    const actor = assertActor(input.actorContext);
    const existing = getActiveEpochRow();
    if (existing) {
      const challenge = findChallenge.get(String(input.challengeId || ''));
      if (existing.device_id === actor.deviceId && existing.user_id === actor.userId
        && challenge && existing.challenge_id === challenge.id) {
        return presentActivatedResult({
          epochRow: existing,
          actor,
          extra: { alreadyActive: true },
          deliveryRequired: false,
        });
      }
      throw hostError('PRIMARY_HOST_ALREADY_BOOTSTRAPPED');
    }
    assertNoPendingRecoveryDelivery(actor.userId);
    const challenge = assertVerifiedChallenge({
      challengeId: requiredText(input.challengeId, 'PRIMARY_HOST_CHALLENGE_REQUIRED'),
      operation: 'bootstrap', actor, expectedRowVersion: input.expectedChallengeRowVersion,
    });
    if (challenge.target_device_id !== actor.deviceId) throw hostError('PRIMARY_HOST_BOOTSTRAP_DEVICE_MISMATCH');
    const receipt = verifyLocalReceipt(input.localReceipt, { challenge, actor, purpose: 'bootstrap' });
    assertReceiptManifest(receipt, input.operationManifest);
    if (receipt.runtimeNodeRole !== 'primary-host') throw hostError('PRIMARY_HOST_RUNTIME_ROLE_REQUIRED');
    const epochId = requiredText(uuid(), 'PRIMARY_HOST_EPOCH_ID_INVALID');
    const prepared = prepareEpochSecrets({
      epochId, userId: actor.userId, deviceId: actor.deviceId, generation: 1,
      credentialStage: input.operationManifest?.credentialStage,
      recoveryDeliveryKey: input.recoveryDeliveryKey,
      operationManifest: input.operationManifest,
      actor,
    });
    const timestamp = currentDate().toISOString();
    db.transaction(() => {
      if (getActiveEpochRow()) throw hostError('PRIMARY_HOST_ALREADY_BOOTSTRAPPED');
      insertEpoch({
        id: epochId, generation: 1, actor, activationReason: 'bootstrap',
        challenge, receipt, credentialHash: prepared.hostCredentialHash, timestamp,
      });
      consumeChallenge(challenge, timestamp);
      db.prepare(`UPDATE desktop_device_authorizations
        SET device_kind='primary-host', row_version=row_version+1, updated_at=?
        WHERE id=? AND status='active'`).run(timestamp, actor.authorization.id);
      recoveryFactors.revokeActiveForUser({ userId: actor.userId });
      recoveryFactors.storePrepared(prepared.recovery);
      recoveryDeliveries.storePrepared(prepared.delivery);
    })();
    return presentActivatedResult({
      epochRow: db.prepare('SELECT * FROM primary_host_epochs WHERE id=?').get(epochId),
      actor,
      extra: { alreadyActive: false },
    });
  }

  function beginTransfer(input = {}) {
    const actor = assertActor(input.actorContext);
    assertNoPendingRecoveryDelivery(actor.userId);
    const active = getActiveEpochRow();
    if (!active) throw hostError('PRIMARY_HOST_NOT_BOOTSTRAPPED');
    if (active.user_id !== actor.userId || active.device_id !== actor.deviceId) {
      throw hostError('PRIMARY_HOST_ACTIVE_DEVICE_REQUIRED');
    }
    if (Number(active.row_version) !== Number(input.expectedActiveEpochRowVersion)) {
      throw hostError('PRIMARY_HOST_EPOCH_VERSION_MISMATCH');
    }
    const challenge = assertVerifiedChallenge({
      challengeId: requiredText(input.challengeId, 'PRIMARY_HOST_CHALLENGE_REQUIRED'),
      operation: 'transfer', actor, expectedRowVersion: input.expectedChallengeRowVersion,
    });
    assertSameOwnerTarget(challenge.target_device_id, actor.userId);
    const transferId = requiredText(uuid(), 'PRIMARY_HOST_TRANSFER_ID_INVALID');
    const timestamp = currentDate().toISOString();
    db.transaction(() => {
      db.prepare(`INSERT INTO host_transfers
        (id, source_epoch_id, source_generation, target_generation, target_device_id,
         user_id, challenge_id, status, row_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_validation', 1, ?, ?)`)
        .run(transferId, active.id, active.generation, Number(active.generation) + 1,
          challenge.target_device_id, actor.userId, challenge.id, timestamp, timestamp);
      consumeChallenge(challenge, timestamp);
    })();
    return presentTransfer(db.prepare('SELECT * FROM host_transfers WHERE id=?').get(transferId));
  }

  function assertBackup(value, active, codePrefix = '') {
    const backup = value || {};
    if (backup.authoritative !== true || !/^[a-f0-9]{64}$/i.test(String(backup.sha256 || ''))
      || Number(backup.sourceGeneration) !== Number(active.generation)
      || !Number.isFinite(Date.parse(String(backup.createdAt || '')))) {
      throw hostError('PRIMARY_HOST_BACKUP_NOT_AUTHORITATIVE');
    }
    void codePrefix;
    return backup;
  }

  function validateAuthorityEvidence(manifest, receipt, active, targetGeneration) {
    const databaseEvidence = manifest?.database || {};
    if (databaseEvidence.quickCheck !== 'ok') throw hostError('PRIMARY_HOST_SQLITE_QUICK_CHECK_FAILED');
    if (Number(databaseEvidence.schemaVersion) !== Number(active.schema_version)
      || Number(databaseEvidence.schemaVersion) !== Number(receipt.schemaVersion)) {
      throw hostError('PRIMARY_HOST_SCHEMA_MISMATCH');
    }
    if (String(databaseEvidence.dbInstanceDigest || '').toLowerCase() !== receipt.dbInstanceDigest) {
      throw hostError('PRIMARY_HOST_DB_DIGEST_MISMATCH');
    }
    if (String(databaseEvidence.dbAuthorityId || '') !== active.db_authority_id
      || String(databaseEvidence.dbAuthorityId || '') !== receipt.dbAuthorityId) {
      throw hostError('PRIMARY_HOST_AUTHORITY_MISMATCH');
    }
    const questionBank = manifest?.questionBank || {};
    if (questionBank.bindingStatus !== 'active'
      || questionBank.storeId !== active.store_id
      || questionBank.storeId !== receipt.storeId) {
      throw hostError('PRIMARY_HOST_STORE_MISMATCH');
    }
    if (questionBank.dbAuthorityId !== active.db_authority_id
      || questionBank.dbAuthorityId !== receipt.dbAuthorityId) {
      throw hostError('PRIMARY_HOST_AUTHORITY_MISMATCH');
    }
    if (manifest?.localPreflight?.status !== 'ok'
      || !Number.isSafeInteger(Number(manifest.localPreflight.tablesChecked))
      || Number(manifest.localPreflight.tablesChecked) < 1) {
      throw hostError('PRIMARY_HOST_LOCAL_PREFLIGHT_FAILED');
    }
    if (manifest?.cloudPreflight?.status !== 'ok'
      || Number(manifest.cloudPreflight.protocolVersion) < 2
      || String(manifest.cloudPreflight.targetDeviceId || '') !== receipt.deviceId) {
      throw hostError('PRIMARY_HOST_CLOUD_PREFLIGHT_FAILED');
    }
    void targetGeneration;
  }

  function validateTransferManifestIdentity(manifest, transfer, active) {
    const identity = manifest?.transfer || {};
    if (String(identity.id || '') !== transfer.id
      || String(identity.sourceEpochId || '') !== transfer.source_epoch_id
      || String(identity.challengeId || '') !== transfer.challenge_id
      || String(identity.targetDeviceId || '') !== transfer.target_device_id
      || Number(identity.sourceGeneration) !== Number(active.generation)
      || Number(identity.sourceGeneration) !== Number(transfer.source_generation)
      || Number(identity.targetGeneration) !== Number(transfer.target_generation)) {
      throw hostError('PRIMARY_HOST_TRANSFER_MANIFEST_MISMATCH');
    }
  }

  function activateTransfer(input = {}) {
    const actor = assertActor(input.actorContext);
    const transferId = requiredText(input.transferId, 'PRIMARY_HOST_TRANSFER_REQUIRED');
    const transfer = db.prepare('SELECT * FROM host_transfers WHERE id=?').get(transferId);
    if (!transfer) throw hostError('PRIMARY_HOST_TRANSFER_NOT_FOUND');
    if (transfer.status === 'activated') {
      const activatedEpoch = getActiveEpochRow();
      if (transfer.target_device_id === actor.deviceId
        && transfer.user_id === actor.userId
        && activatedEpoch?.device_id === actor.deviceId
        && activatedEpoch?.user_id === actor.userId
        && activatedEpoch?.activation_reason === 'transfer'
        && activatedEpoch?.source_epoch_id === transfer.source_epoch_id
        && activatedEpoch?.challenge_id === transfer.challenge_id) {
        return presentActivatedResult({
          epochRow: activatedEpoch,
          actor,
          extra: { transfer: presentTransfer(transfer) },
        });
      }
      throw hostError('PRIMARY_HOST_TRANSFER_STATE_INVALID');
    }
    assertNoPendingRecoveryDelivery(actor.userId);
    if (transfer.status !== 'pending_validation') throw hostError('PRIMARY_HOST_TRANSFER_STATE_INVALID');
    if (Number(transfer.row_version) !== Number(input.expectedTransferRowVersion)) {
      throw hostError('PRIMARY_HOST_TRANSFER_VERSION_MISMATCH');
    }
    if (transfer.target_device_id !== actor.deviceId || transfer.user_id !== actor.userId) {
      throw hostError('PRIMARY_HOST_TRANSFER_TARGET_MISMATCH');
    }
    const active = getActiveEpochRow();
    if (!active || active.id !== transfer.source_epoch_id
      || Number(active.generation) !== Number(transfer.source_generation)) {
      throw hostError('PRIMARY_HOST_EPOCH_CHANGED');
    }
    const challenge = findChallenge.get(transfer.challenge_id);
    if (!challenge || challenge.status !== 'consumed') throw hostError('PRIMARY_HOST_PHONE_PROOF_REQUIRED');
    const receipt = verifyLocalReceipt(input.localReceipt, { challenge, actor, purpose: 'transfer' });
    validateTransferManifestIdentity(input.validationManifest, transfer, active);
    assertBackup(input.validationManifest?.backup, active);
    validateAuthorityEvidence(input.validationManifest, receipt, active, transfer.target_generation);
    const epochId = requiredText(uuid(), 'PRIMARY_HOST_EPOCH_ID_INVALID');
    const prepared = prepareEpochSecrets({
      epochId, userId: actor.userId, deviceId: actor.deviceId, generation: transfer.target_generation,
      credentialStage: input.validationManifest?.credentialStage,
      recoveryDeliveryKey: input.recoveryDeliveryKey,
      operationManifest: input.validationManifest,
      actor,
    });
    const timestamp = currentDate().toISOString();
    const manifestHash = sha256(JSON.stringify(input.validationManifest));
    db.transaction(() => {
      preflightProofs.consume({
        actorContext: input.actorContext,
        operation: 'transfer',
        challengeId: transfer.challenge_id,
        transferId: transfer.id,
        sourceEpochId: active.id,
        sourceGeneration: active.generation,
        targetGeneration: transfer.target_generation,
        operationManifest: input.validationManifest,
        localReceipt: input.localReceipt,
        preflightProof: input.preflightProof,
      });
      const retired = db.prepare(`UPDATE primary_host_epochs
        SET status='retired', retired_at=?, row_version=row_version+1, updated_at=?
        WHERE id=? AND status='active' AND row_version=?`)
        .run(timestamp, timestamp, active.id, active.row_version);
      if (retired.changes !== 1) throw hostError('PRIMARY_HOST_EPOCH_VERSION_MISMATCH');
      insertEpoch({
        id: epochId, generation: transfer.target_generation, actor,
        activationReason: 'transfer', sourceEpochId: active.id, challenge,
        receipt, credentialHash: prepared.hostCredentialHash,
        credentialVersion: Number(active.credential_version) + 1, timestamp,
      });
      const activated = db.prepare(`UPDATE host_transfers
        SET status='activated', validation_manifest_hash=?, activated_at=?,
            row_version=row_version+1, updated_at=?
        WHERE id=? AND status='pending_validation' AND row_version=?`)
        .run(manifestHash, timestamp, timestamp, transfer.id, transfer.row_version);
      if (activated.changes !== 1) throw hostError('PRIMARY_HOST_TRANSFER_VERSION_MISMATCH');
      db.prepare(`UPDATE desktop_device_authorizations
        SET device_kind=CASE WHEN device_id=? THEN 'primary-host' ELSE 'desktop-client' END,
            row_version=row_version+1, updated_at=?
        WHERE device_id IN (?, ?) AND status='active'`)
        .run(actor.deviceId, timestamp, active.device_id, actor.deviceId);
      recoveryFactors.revokeActiveForUser({ userId: actor.userId });
      recoveryFactors.storePrepared(prepared.recovery);
      recoveryDeliveries.storePrepared(prepared.delivery);
    })();
    return presentActivatedResult({
      epochRow: db.prepare('SELECT * FROM primary_host_epochs WHERE id=?').get(epochId),
      actor,
      extra: {
        transfer: presentTransfer(db.prepare('SELECT * FROM host_transfers WHERE id=?').get(transfer.id)),
      },
    });
  }

  function validateRecoveryEvidence(evidence, receipt, active) {
    assertBackup(evidence?.authoritativeBackup, active);
    validateAuthorityEvidence(evidence, receipt, active, Number(active.generation) + 1);
  }

  function readActiveHostHeartbeat(active) {
    return findHostHeartbeat.get(active.device_id) || null;
  }

  function assertOldHostUnreachable(active, heartbeatRow = readActiveHostHeartbeat(active)) {
    const updatedAt = Date.parse(String(heartbeatRow?.updated_at || ''));
    const durationMs = currentDate().getTime() - updatedAt;
    if (!heartbeatRow || !Number.isFinite(updatedAt) || durationMs < MIN_UNREACHABLE_DURATION_MS) {
      throw hostError('PRIMARY_HOST_OLD_HOST_STILL_REACHABLE');
    }
    return Object.freeze({
      status: heartbeatRow.status,
      updatedAt: heartbeatRow.updated_at,
      durationMs,
    });
  }

  function recover(input = {}) {
    const actor = assertActor(input.actorContext);
    const active = getActiveEpochRow();
    if (!active) throw hostError('PRIMARY_HOST_NOT_BOOTSTRAPPED');
    if (active.user_id !== actor.userId) throw hostError('PRIMARY_HOST_OWNER_MISMATCH');
    const challengeId = requiredText(input.challengeId, 'PRIMARY_HOST_CHALLENGE_REQUIRED');
    const challengeCandidate = findChallenge.get(challengeId);
    if (challengeCandidate?.status === 'consumed'
      && challengeCandidate.operation === 'recovery'
      && challengeCandidate.requested_by_user_id === actor.userId
      && challengeCandidate.target_device_id === actor.deviceId
      && active.device_id === actor.deviceId
      && active.user_id === actor.userId
      && active.activation_reason === 'recovery'
      && active.challenge_id === challengeCandidate.id) {
      return presentActivatedResult({ epochRow: active, actor });
    }
    assertNoPendingRecoveryDelivery(actor.userId);
    const challenge = assertVerifiedChallenge({
      challengeId,
      operation: 'recovery', actor, expectedRowVersion: input.expectedChallengeRowVersion,
    });
    if (active.device_id === actor.deviceId) throw hostError('PRIMARY_HOST_RECOVERY_TARGET_UNCHANGED');
    if (challenge.target_device_id !== actor.deviceId) throw hostError('PRIMARY_HOST_RECOVERY_TARGET_MISMATCH');
    const factor = recoveryFactors.assertUnused({
      factorId: input.factorId,
      recoveryCode: input.recoveryCode,
      userId: actor.userId,
    });
    if (factor.epochId !== active.id || Number(factor.generation) !== Number(active.generation)) {
      throw hostError('PRIMARY_HOST_RECOVERY_FACTOR_EPOCH_MISMATCH');
    }
    const receipt = verifyLocalReceipt(input.localReceipt, { challenge, actor, purpose: 'recovery' });
    validateRecoveryEvidence(input.evidence, receipt, active);
    const heartbeatObservation = assertOldHostUnreachable(active);
    const nextGeneration = Number(active.generation) + 1;
    const epochId = requiredText(uuid(), 'PRIMARY_HOST_EPOCH_ID_INVALID');
    const prepared = prepareEpochSecrets({
      epochId, userId: actor.userId, deviceId: actor.deviceId, generation: nextGeneration,
      credentialStage: input.evidence?.credentialStage,
      recoveryDeliveryKey: input.recoveryDeliveryKey,
      operationManifest: input.evidence,
      actor,
    });
    const timestamp = currentDate().toISOString();
    db.transaction(() => {
      const latestHeartbeat = readActiveHostHeartbeat(active);
      if (!latestHeartbeat
        || latestHeartbeat.updated_at !== heartbeatObservation.updatedAt
        || latestHeartbeat.status !== heartbeatObservation.status) {
        throw hostError('PRIMARY_HOST_OLD_HOST_HEARTBEAT_CHANGED');
      }
      assertOldHostUnreachable(active, latestHeartbeat);
      preflightProofs.consume({
        actorContext: input.actorContext,
        operation: 'recovery',
        challengeId: challenge.id,
        sourceEpochId: active.id,
        sourceGeneration: active.generation,
        targetGeneration: nextGeneration,
        operationManifest: input.evidence,
        localReceipt: input.localReceipt,
        preflightProof: input.preflightProof,
      });
      const retired = db.prepare(`UPDATE primary_host_epochs
        SET status='recovery_superseded', retired_at=?, row_version=row_version+1, updated_at=?
        WHERE id=? AND status='active' AND row_version=?`)
        .run(timestamp, timestamp, active.id, active.row_version);
      if (retired.changes !== 1) throw hostError('PRIMARY_HOST_EPOCH_VERSION_MISMATCH');
      recoveryFactors.consumeVerified({ factor, usedByDeviceId: actor.deviceId });
      insertEpoch({
        id: epochId, generation: nextGeneration, actor,
        activationReason: 'recovery', sourceEpochId: active.id, challenge,
        receipt, credentialHash: prepared.hostCredentialHash,
        credentialVersion: Number(active.credential_version) + 1, timestamp,
      });
      consumeChallenge(challenge, timestamp);
      db.prepare(`UPDATE desktop_device_authorizations
        SET device_kind=CASE WHEN device_id=? THEN 'primary-host' ELSE 'desktop-client' END,
            row_version=row_version+1, updated_at=?
        WHERE device_id IN (?, ?) AND status='active'`)
        .run(actor.deviceId, timestamp, active.device_id, actor.deviceId);
      recoveryFactors.revokeActiveForUser({
        userId: actor.userId,
        exceptFactorId: prepared.recovery.recoveryPackage.factorId,
      });
      recoveryFactors.storePrepared(prepared.recovery);
      recoveryDeliveries.storePrepared(prepared.delivery);
    })();
    return presentActivatedResult({
      epochRow: db.prepare('SELECT * FROM primary_host_epochs WHERE id=?').get(epochId),
      actor,
    });
  }

  function acknowledgeRecoveryDelivery(input = {}) {
    const actor = assertActor(input.actorContext);
    return recoveryDeliveries.acknowledge({
      actor: { userId: actor.userId, deviceId: actor.deviceId },
      acknowledgement: input.acknowledgement,
      signature: input.signature,
    });
  }

  function assertActiveHostCredential(input = {}) {
    const deviceId = requiredText(input.deviceId, 'PRIMARY_HOST_DEVICE_REQUIRED');
    const requestedGeneration = safeInteger(input.generation, 'PRIMARY_HOST_GENERATION_INVALID');
    const credential = requiredText(input.credential, 'PRIMARY_HOST_CREDENTIAL_REQUIRED', 512);
    const active = getActiveEpochRow();
    if (!active) throw hostError('PRIMARY_HOST_NOT_BOOTSTRAPPED');
    if (Number(active.generation) !== requestedGeneration || active.device_id !== deviceId) {
      const requested = db.prepare('SELECT * FROM primary_host_epochs WHERE generation=?').get(requestedGeneration);
      if (requested && requested.status !== 'active') throw hostError('PRIMARY_HOST_EPOCH_RETIRED');
      throw hostError('PRIMARY_HOST_CREDENTIAL_MISMATCH');
    }
    if (!safeHashEqual(credential, active.host_credential_hash)) {
      throw hostError('PRIMARY_HOST_CREDENTIAL_INVALID');
    }
    return presentEpoch(active);
  }

  function verifyCredentialAdoption(input = {}) {
    const actor = assertActor(input.actorContext);
    const epochId = requiredText(input.epochId, 'PRIMARY_HOST_EPOCH_ID_INVALID');
    const epoch = assertActiveHostCredential(input);
    if (epoch.id !== epochId || epoch.userId !== actor.userId
      || epoch.authorizationId !== actor.authorization.id
      || epoch.deviceId !== actor.deviceId) {
      throw hostError('PRIMARY_HOST_CREDENTIAL_ADOPTION_MISMATCH');
    }
    return epoch;
  }

  function getStatus(actorContext) {
    const actor = assertActor(actorContext);
    const active = getActiveEpochRow();
    const transfers = db.prepare(`SELECT * FROM host_transfers
      WHERE user_id=? ORDER BY created_at DESC LIMIT 20`).all(actor.userId).map(presentTransfer);
    const history = db.prepare(`SELECT * FROM primary_host_epochs
      WHERE user_id=? ORDER BY generation DESC LIMIT 20`).all(actor.userId).map(presentEpoch);
    let activeEpoch = presentEpoch(active);
    if (activeEpoch) {
      const heartbeatRow = findHostHeartbeat.get(activeEpoch.deviceId);
      let heartbeat = Object.freeze({ status: 'unknown', updatedAt: null, consecutiveFailures: 0 });
      if (heartbeatRow) {
        const updatedAt = Date.parse(String(heartbeatRow.updated_at || ''));
        const elapsedMs = Number.isFinite(updatedAt)
          ? Math.max(0, currentDate().getTime() - updatedAt)
          : Number.POSITIVE_INFINITY;
        const online = heartbeatRow.status !== 'offline' && elapsedMs <= heartbeatTtlMs;
        heartbeat = Object.freeze({
          status: online ? 'online' : 'offline',
          updatedAt: heartbeatRow.updated_at || null,
          consecutiveFailures: online || !Number.isFinite(elapsedMs) ? 0 : Math.floor(elapsedMs / heartbeatTtlMs),
        });
      }
      activeEpoch = Object.freeze({ ...activeEpoch, heartbeat });
    }
    const result = {
      activeEpoch,
      transfers: Object.freeze(transfers),
      history: Object.freeze(history),
      recoveryDeliveryPending: recoveryDeliveries.hasPendingForUser(actor.userId),
    };
    const pendingRecoveryDelivery = recoveryDeliveries.getPendingSummary({
      userId: actor.userId,
      deviceId: actor.deviceId,
    });
    if (pendingRecoveryDelivery) {
      result.pendingRecoveryDelivery = recoveryDeliveries.getTargetDelivery({
        id: pendingRecoveryDelivery.id,
        userId: actor.userId,
        deviceId: actor.deviceId,
      });
    }
    return Object.freeze(result);
  }

  function issuePreflightProof(input = {}) {
    assertActor(input.actorContext);
    return preflightProofs.issue(input);
  }

  return Object.freeze({
    acknowledgeRecoveryDelivery,
    activateTransfer,
    assertActiveHostCredential,
    beginTransfer,
    bootstrap,
    confirmOperationChallenge,
    getActiveEpoch,
    getStatus,
    issuePreflightProof,
    collectLocalEvidence,
    readOperationChallenge,
    readPublicOperationChallenge,
    recover,
    startOperationChallenge,
    verifyCredentialAdoption,
  });
}

module.exports = {
  CHALLENGE_TTL_MS,
  MIN_UNREACHABLE_DURATION_MS,
  PHYSICAL_CONFIRMATION,
  RECEIPT_TTL_MS,
  createPrimaryHostIdentityService,
  insertPrimaryHostEpochRow,
};
