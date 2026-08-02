const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE } = require('./authorizationPolicy');
const {
  createPrimaryHostIdentityService,
  insertPrimaryHostEpochRow,
} = require('./primaryHostIdentityService');
const {
  PHYSICAL_CONFIRMATION,
  createPrimaryHostLocalReceipt,
  primaryHostReceiptSigningPayload,
} = require('./primaryHostReceiptProtocol');
const {
  ACK_SIGNATURE_ALGORITHM,
  CONTENT_ENCRYPTION_ALGORITHM,
  DELIVERY_PROTOCOL_VERSION,
  KEY_WRAP_ALGORITHM,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  generateRecoveryDeliveryKeyPair,
  openRecoveryPackage,
  signRecoveryDeliveryAcknowledgement,
} = require('./primaryHostRecoveryDeliveryProtocol');
const { derivePrimaryHostSigningKey } = require('../../../shared/primaryHostSigningKey');

const db = new Database(':memory:');
assert.strictEqual(typeof insertPrimaryHostEpochRow, 'function');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

let currentTime = '2026-07-18T00:00:00.000Z';
let idSequence = 0;
let secretSequence = 0;
let randomBytesHook = null;
const now = () => new Date(currentTime);
const uuid = () => `host-test-id-${++idSequence}`;
const randomBytes = size => {
  if (randomBytesHook) {
    const hook = randomBytesHook;
    randomBytesHook = null;
    hook();
  }
  return Buffer.alloc(size, ++secretSequence);
};
const authorityByDevice = new Map([
  ['host-device-1', {
    runtimeNodeRole: 'primary-host', dbInstanceDigest: 'a'.repeat(64), schemaVersion: 3109,
    storeId: 'store-authority-1', dbAuthorityId: 'db-authority-1', quickCheck: 'ok',
  }],
  ['host-device-2', {
    runtimeNodeRole: 'desktop-client', dbInstanceDigest: 'b'.repeat(64), schemaVersion: 3109,
    storeId: 'store-authority-1', dbAuthorityId: 'db-authority-1', quickCheck: 'ok',
  }],
]);
const deviceKeys = new Map();

function keyPairForDevice(deviceId) {
  if (!deviceKeys.has(deviceId)) deviceKeys.set(deviceId, crypto.generateKeyPairSync('ed25519'));
  return deviceKeys.get(deviceId);
}

const service = createPrimaryHostIdentityService({
  db,
  now,
  uuid,
  randomBytes,
  localEvidenceProvider: ({ deviceId }) => authorityByDevice.get(deviceId),
  preflightProofService: {
    issue: input => input,
    consume: input => {
      if (input.preflightProof?.token !== `${input.operation}-proof`) {
        const error = new Error('PRIMARY_HOST_PREFLIGHT_PROOF_REQUIRED');
        error.code = 'PRIMARY_HOST_PREFLIGHT_PROOF_REQUIRED';
        throw error;
      }
      if (input.operationManifest?.attestationTamper) {
        const error = new Error('PRIMARY_HOST_PREFLIGHT_PROOF_CONTEXT_MISMATCH');
        error.code = 'PRIMARY_HOST_PREFLIGHT_PROOF_CONTEXT_MISMATCH';
        throw error;
      }
      return { manifestHash: 'proof-test' };
    },
  },
});

function insertUser(id, phone, name = id) {
  db.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, review_status, auth_version,
     is_super_admin_identity, deleted, created_at, updated_at)
    VALUES (?, ?, ?, 'super_admin', 1, 1, 'approved', 1, ?, 0, ?, ?)`)
    .run(id, phone, name, id === CANONICAL_SUPER_ADMIN_ID ? 1 : 0, currentTime, currentTime);
}

function insertGrant(userId, role, subjectType = null, subjectId = null) {
  db.prepare(`INSERT INTO user_role_grants
    (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', 'host-test', ?, ?)`)
    .run(userId, role, subjectType, subjectId, currentTime, currentTime);
}

function insertDevice(id, userId, kind = 'desktop-client') {
  const keyPair = keyPairForDevice(id);
  const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  db.prepare(`INSERT INTO desktop_device_authorizations
    (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
     status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
     credential_version, row_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1, 1, ?, ?)`)
    .run(`authorization-${id}`, id, id, kind, userId, publicKey,
      crypto.createHash('sha256').update(keyPair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'), `source-${id}`,
      currentTime, '2026-08-18T00:00:00.000Z', currentTime, currentTime);
}

function actor(deviceId, userId = CANONICAL_SUPER_ADMIN_ID) {
  return {
    userId,
    deviceId,
    authorizationId: `authorization-${deviceId}`,
    activeRole: 'super_admin',
    eligibleRoles: ['super_admin', 'teacher'],
    teacherId: 'teacher-owner',
    authVersion: 1,
    credentialVersion: 1,
    userApproved: true,
    deviceActive: true,
    deviceTrusted: true,
    deviceOwnerUserId: userId,
  };
}

function insertFreshLoginEvent(id, userId = CANONICAL_SUPER_ADMIN_ID) {
  db.prepare(`INSERT INTO miniapp_login_events
    (id, user_id, phone_normalized, identity_kind, result_code, session_id,
     miniapp_version, platform, created_at)
    VALUES (?, ?, ?, 'admin', 'FORMAL_LOGIN_SUCCESS', ?, 'host-test', 'weapp', ?)`)
    .run(id, userId, userId === CANONICAL_SUPER_ADMIN_ID ? SUPER_ADMIN_PHONE : '13000000009',
      `session-${id}`, currentTime);
}

function verifyPhone(challenge, loginEventId) {
  insertFreshLoginEvent(loginEventId);
  return service.confirmOperationChallenge({
    challengeId: challenge.id,
    identity: { id: CANONICAL_SUPER_ADMIN_ID },
    loginEventId,
    expectedRowVersion: challenge.rowVersion,
  });
}

function localReceipt(challenge, targetActor, purpose = challenge.operation, operationManifest = null) {
  const receipt = createPrimaryHostLocalReceipt({
    operation: purpose,
    challengeId: challenge.id,
    identity: {
      userId: targetActor.userId,
      deviceId: targetActor.deviceId,
      authorizationId: targetActor.authorizationId,
      credentialVersion: targetActor.credentialVersion,
    },
    evidence: service.collectLocalEvidence({ deviceId: targetActor.deviceId, purpose }),
    physicalConfirmation: PHYSICAL_CONFIRMATION,
    operationManifest,
    now,
  });
  const signature = crypto.sign(
    null,
    Buffer.from(primaryHostReceiptSigningPayload(receipt), 'utf8'),
    keyPairForDevice(targetActor.deviceId).privateKey
  ).toString('base64');
  return { receipt, signature };
}

function credentialCommitment(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const stagedHostCredentials = {
  bootstrap: 'locally-staged-bootstrap-host-credential',
  transfer: 'locally-staged-transfer-host-credential',
  recovery: 'locally-staged-recovery-host-credential',
};

const recoveryDeliveryKeyPairs = Object.freeze({
  bootstrap: generateRecoveryDeliveryKeyPair(),
  transfer: generateRecoveryDeliveryKeyPair(),
  recovery: generateRecoveryDeliveryKeyPair(),
});

function recoveryDeliveryDescriptor(operation) {
  const key = recoveryDeliveryKeyPairs[operation];
  return Object.freeze({
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    keyAlgorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
    keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
    contentEncryptionAlgorithm: CONTENT_ENCRYPTION_ALGORITHM,
    acknowledgementSignatureAlgorithm: ACK_SIGNATURE_ALGORITHM,
    recipientKeyFingerprint: key.publicKeyFingerprint,
  });
}

function recoveryDeliveryPublicKey(operation) {
  const key = recoveryDeliveryKeyPairs[operation];
  return Object.freeze({
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
    publicKeyPem: key.publicKeyPem,
    publicKeyFingerprint: key.publicKeyFingerprint,
  });
}

function decryptRecoveryDelivery(result, operation, deviceId) {
  const delivery = result.recoveryDelivery;
  assert.ok(delivery?.envelope, `${operation} must return a target-device envelope`);
  return openRecoveryPackage({
    envelope: delivery.envelope,
    privateKeyPem: recoveryDeliveryKeyPairs[operation].privateKeyPem,
    expected: {
      epochId: delivery.epochId,
      factorId: delivery.factorId,
      deviceId,
      generation: delivery.generation,
      recipientPublicKeyFingerprint: delivery.recipientKeyFingerprint,
    },
  });
}

function acknowledgeRecoveryDelivery(result, operation, actorContext) {
  const delivery = result.recoveryDelivery;
  const acknowledgement = {
    deliveryId: delivery.id,
    epochId: delivery.epochId,
    factorId: delivery.factorId,
    recipientKeyFingerprint: delivery.recipientKeyFingerprint,
    expectedRowVersion: delivery.rowVersion,
    acknowledgementNonce: delivery.ackNonce,
    acknowledgedAt: currentTime,
  };
  return service.acknowledgeRecoveryDelivery({
    actorContext,
    acknowledgement,
    signature: signRecoveryDeliveryAcknowledgement({
      acknowledgement,
      privateKeyPem: recoveryDeliveryKeyPairs[operation].privateKeyPem,
    }),
  });
}

function credentialStage(operation, challengeId, deviceId, targetGeneration) {
  const signingKey = derivePrimaryHostSigningKey(stagedHostCredentials[operation]);
  return {
    id: `${operation}:${challengeId}`,
    deviceId,
    targetGeneration,
    commitment: credentialCommitment(stagedHostCredentials[operation]),
    hostSigningKey: {
      algorithm: signingKey.algorithm,
      publicKeyPem: signingKey.publicKeyPem,
      publicKeyFingerprint: signingKey.publicKeyFingerprint,
    },
  };
}

function transferManifest(overrides = {}) {
  return {
    backup: {
      authoritative: true,
      sha256: 'd'.repeat(64),
      sourceGeneration: 1,
      createdAt: currentTime,
    },
    database: {
      quickCheck: 'ok',
      schemaVersion: 3109,
      dbInstanceDigest: 'b'.repeat(64),
      dbAuthorityId: 'db-authority-1',
    },
    questionBank: {
      storeId: 'store-authority-1',
      dbAuthorityId: 'db-authority-1',
      bindingStatus: 'active',
    },
    localPreflight: { status: 'ok', tablesChecked: 17 },
    cloudPreflight: { status: 'ok', protocolVersion: 2, targetDeviceId: 'host-device-2' },
    credentialStage: credentialStage('transfer', 'host-challenge-3', 'host-device-2', 2),
    recoveryDelivery: recoveryDeliveryDescriptor('transfer'),
    ...overrides,
  };
}

function recoveryEvidence(overrides = {}) {
  return {
    authoritativeBackup: {
      authoritative: true,
      sha256: 'e'.repeat(64),
      sourceGeneration: 2,
      createdAt: currentTime,
    },
    database: {
      quickCheck: 'ok',
      schemaVersion: 3109,
      dbInstanceDigest: 'a'.repeat(64),
      dbAuthorityId: 'db-authority-1',
    },
    questionBank: {
      storeId: 'store-authority-1',
      dbAuthorityId: 'db-authority-1',
      bindingStatus: 'active',
    },
    oldHostUnreachable: {
      generation: 2,
      consecutiveFailures: 3,
      durationMs: 15 * 60 * 1000,
      observedAt: currentTime,
    },
    localPreflight: { status: 'ok', tablesChecked: 17 },
    cloudPreflight: { status: 'ok', protocolVersion: 2, targetDeviceId: 'host-device-1' },
    credentialStage: credentialStage('recovery', 'host-challenge-4', 'host-device-1', 3),
    recoveryDelivery: recoveryDeliveryDescriptor('recovery'),
    ...overrides,
  };
}

insertUser(CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE, 'Canonical owner');
insertGrant(CANONICAL_SUPER_ADMIN_ID, 'super_admin');
insertGrant(CANONICAL_SUPER_ADMIN_ID, 'teacher', 'teacher', 'teacher-owner');
db.prepare(`INSERT INTO teachers (id, name, created_at, updated_at)
  VALUES ('teacher-owner', 'Canonical teacher', ?, ?)`).run(currentTime, currentTime);
insertDevice('host-device-1', CANONICAL_SUPER_ADMIN_ID, 'primary-host');
insertDevice('host-device-2', CANONICAL_SUPER_ADMIN_ID);
insertUser('other-super-admin', '13000000009', 'Other admin');
insertGrant('other-super-admin', 'super_admin');
insertDevice('other-device', 'other-super-admin');
db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
  VALUES(?,'previous-authority','active',?,?)`).run(CANONICAL_SUPER_ADMIN_ID, currentTime, currentTime);
db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
   granted_by,created_at,updated_at,revoked_at)
  VALUES('previous-authority-super-admin','previous-authority',?,'super_admin',NULL,NULL,
    'active',1,?,?,?,NULL)`)
  .run(CANONICAL_SUPER_ADMIN_ID, CANONICAL_SUPER_ADMIN_ID, currentTime, currentTime);

for (const table of [
  'primary_host_operation_challenges', 'primary_host_epochs', 'host_transfers', 'host_recovery_factors',
]) {
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} must exist`);
}

assert.throws(
  () => service.startOperationChallenge({ actorContext: actor('other-device', 'other-super-admin'), operation: 'bootstrap' }),
  error => error?.code === 'PRIMARY_HOST_CANONICAL_SUPER_ADMIN_REQUIRED'
);

const bootstrapChallenge = service.startOperationChallenge({
  actorContext: actor('host-device-1'),
  operation: 'bootstrap',
  targetDeviceId: 'host-device-1',
});
assert.strictEqual(bootstrapChallenge.status, 'pending_phone');
assert.strictEqual(bootstrapChallenge.operation, 'bootstrap');
assert.throws(
  () => service.bootstrap({
    actorContext: actor('host-device-1'),
    challengeId: bootstrapChallenge.id,
    expectedChallengeRowVersion: bootstrapChallenge.rowVersion,
    localReceipt: {},
  }),
  error => error?.code === 'PRIMARY_HOST_PHONE_PROOF_REQUIRED'
);

const verifiedBootstrap = verifyPhone(bootstrapChallenge, 'host-login-bootstrap');
assert.strictEqual(verifiedBootstrap.status, 'identity_verified');
assert.throws(
  () => createPrimaryHostLocalReceipt({
    operation: 'bootstrap',
    challengeId: bootstrapChallenge.id,
    identity: actor('host-device-1'),
    evidence: authorityByDevice.get('host-device-1'),
    physicalConfirmation: 'not-confirmed',
  }),
  error => error?.code === 'PRIMARY_HOST_PHYSICAL_CONFIRMATION_REQUIRED'
);

const originalHostEvidence = authorityByDevice.get('host-device-1');
for (const [name, invalid, expectedCode] of [
  ['nodeRole', { ...originalHostEvidence, runtimeNodeRole: 'desktop-client' }, 'PRIMARY_HOST_RUNTIME_ROLE_REQUIRED'],
  ['db digest', { ...originalHostEvidence, dbInstanceDigest: '' }, 'PRIMARY_HOST_DB_DIGEST_REQUIRED'],
  ['schema', { ...originalHostEvidence, schemaVersion: 0 }, 'PRIMARY_HOST_SCHEMA_EVIDENCE_REQUIRED'],
  ['store', { ...originalHostEvidence, storeId: '' }, 'PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED'],
  ['authority', { ...originalHostEvidence, dbAuthorityId: '' }, 'PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED'],
]) {
  authorityByDevice.set('host-device-1', invalid);
  assert.throws(
    () => service.collectLocalEvidence({ deviceId: 'host-device-1', purpose: 'bootstrap' }),
    error => error?.code === expectedCode,
    name
  );
}
authorityByDevice.set('host-device-1', originalHostEvidence);

const bootstrapManifest = {
  credentialStage: credentialStage('bootstrap', verifiedBootstrap.id, 'host-device-1', 1),
  recoveryDelivery: recoveryDeliveryDescriptor('bootstrap'),
};
const bootstrapReceipt = localReceipt(verifiedBootstrap, actor('host-device-1'), 'bootstrap', bootstrapManifest);
assert.throws(
  () => service.bootstrap({
    actorContext: actor('host-device-1'),
    challengeId: verifiedBootstrap.id,
    expectedChallengeRowVersion: verifiedBootstrap.rowVersion,
    localReceipt: bootstrapReceipt,
    operationManifest: bootstrapManifest,
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED'
);
const bootstrapped = service.bootstrap({
  actorContext: actor('host-device-1'),
  challengeId: verifiedBootstrap.id,
  expectedChallengeRowVersion: verifiedBootstrap.rowVersion,
  localReceipt: bootstrapReceipt,
  operationManifest: bootstrapManifest,
  recoveryDeliveryKey: recoveryDeliveryPublicKey('bootstrap'),
});
assert.strictEqual(bootstrapped.epoch.generation, 1);
assert.strictEqual(bootstrapped.epoch.status, 'active');
assert.strictEqual(bootstrapped.epoch.deviceId, 'host-device-1');
const bootstrapHostGrant = db.prepare(`SELECT * FROM device_grants
  WHERE authority_id=? AND device_id=? AND status='active'`).get(bootstrapped.epoch.dbAuthorityId, 'host-device-1');
const bootstrapHostLease = bootstrapHostGrant && db.prepare(`SELECT * FROM device_leases
  WHERE grant_id=? AND status='active'`).get(bootstrapHostGrant.grant_id);
const bootstrapHostAccount = db.prepare(`SELECT * FROM authority_accounts
  WHERE authority_id=? AND user_id=? AND status='active'`).get(
  bootstrapped.epoch.dbAuthorityId,
  CANONICAL_SUPER_ADMIN_ID,
);
assert.ok(bootstrapHostGrant, 'primary-host bootstrap must create an active authority device grant for the host itself');
assert.ok(bootstrapHostLease, 'primary-host bootstrap must create an active authority lease for the host itself');
assert.ok(bootstrapHostAccount, 'primary-host bootstrap must create an active authority account for projection publication');
assert.strictEqual(
  db.prepare("SELECT status FROM authority_role_bindings WHERE binding_id='previous-authority-super-admin'").get().status,
  'revoked',
  'moving the canonical account to a new database authority must revoke orphaned active bindings from its previous authority',
);
assert.strictEqual(bootstrapHostGrant.user_id, CANONICAL_SUPER_ADMIN_ID);
assert.strictEqual(bootstrapHostLease.active_role, 'super_admin');
assert.strictEqual(
  bootstrapped.epoch.hostPublicKey,
  credentialStage('bootstrap', verifiedBootstrap.id, 'host-device-1', 1)
    .hostSigningKey.publicKeyPem
);
assert.strictEqual(Object.hasOwn(bootstrapped, 'hostCredential'), false);
assert.strictEqual(Object.hasOwn(bootstrapped, 'recoveryPackage'), false);
const bootstrapRecoveryPackage = decryptRecoveryDelivery(bootstrapped, 'bootstrap', 'host-device-1');
assert.ok(bootstrapRecoveryPackage.recoveryCode.length >= 32);
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM primary_host_epochs').all()).includes(stagedHostCredentials.bootstrap));
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM host_recovery_factors').all()).includes(bootstrapRecoveryPackage.recoveryCode));
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM host_recovery_deliveries').all()).includes(bootstrapRecoveryPackage.recoveryCode));
assert.strictEqual(service.assertActiveHostCredential({
  deviceId: 'host-device-1', generation: 1, credential: stagedHostCredentials.bootstrap,
}).generation, 1);

const repeatedBootstrap = service.bootstrap({
  actorContext: actor('host-device-1'),
  challengeId: verifiedBootstrap.id,
  expectedChallengeRowVersion: verifiedBootstrap.rowVersion + 1,
  localReceipt: bootstrapReceipt,
  operationManifest: bootstrapManifest,
  recoveryDeliveryKey: recoveryDeliveryPublicKey('bootstrap'),
});
assert.strictEqual(repeatedBootstrap.epoch.generation, 1);
assert.strictEqual(repeatedBootstrap.alreadyActive, true);
assert.strictEqual(Object.hasOwn(repeatedBootstrap, 'hostCredential'), false);
assert.strictEqual(repeatedBootstrap.recoveryDelivery.id, bootstrapped.recoveryDelivery.id);
assert.deepStrictEqual(repeatedBootstrap.recoveryDelivery.envelope, bootstrapped.recoveryDelivery.envelope);
assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM primary_host_epochs").get().count, 1);

const bootstrapTargetStatus = service.getStatus(actor('host-device-1'));
assert.strictEqual(bootstrapTargetStatus.recoveryDeliveryPending, true);
assert.strictEqual(bootstrapTargetStatus.pendingRecoveryDelivery.id, bootstrapped.recoveryDelivery.id);
const bootstrapOtherDeviceStatus = service.getStatus(actor('host-device-2'));
assert.strictEqual(bootstrapOtherDeviceStatus.recoveryDeliveryPending, true);
assert.strictEqual(Object.hasOwn(bootstrapOtherDeviceStatus, 'pendingRecoveryDelivery'), false);
assert.throws(
  () => service.startOperationChallenge({
    actorContext: actor('host-device-1'), operation: 'transfer', targetDeviceId: 'host-device-2',
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_PENDING'
);
assert.strictEqual(
  acknowledgeRecoveryDelivery(bootstrapped, 'bootstrap', actor('host-device-1')).status,
  'acknowledged'
);
assert.strictEqual(service.getStatus(actor('host-device-1')).recoveryDeliveryPending, false);

assert.throws(
  () => service.startOperationChallenge({
    actorContext: actor('host-device-1'), operation: 'transfer', targetDeviceId: 'other-device',
  }),
  error => error?.code === 'PRIMARY_HOST_TARGET_OWNER_MISMATCH'
);

currentTime = '2026-07-18T00:05:00.000Z';
const transferChallenge = service.startOperationChallenge({
  actorContext: actor('host-device-1'), operation: 'transfer', targetDeviceId: 'host-device-2',
});
const verifiedTransfer = verifyPhone(transferChallenge, 'host-login-transfer');
const pendingTransfer = service.beginTransfer({
  actorContext: actor('host-device-1'),
  challengeId: verifiedTransfer.id,
  expectedChallengeRowVersion: verifiedTransfer.rowVersion,
  expectedActiveEpochRowVersion: bootstrapped.epoch.rowVersion,
});
assert.strictEqual(pendingTransfer.status, 'pending_validation');
assert.strictEqual(pendingTransfer.targetGeneration, 2);
assert.strictEqual(service.getActiveEpoch().generation, 1);

const validManifest = transferManifest({
  transfer: {
    id: pendingTransfer.id,
    sourceEpochId: pendingTransfer.sourceEpochId,
    challengeId: pendingTransfer.challengeId,
    targetDeviceId: pendingTransfer.targetDeviceId,
    sourceGeneration: pendingTransfer.sourceGeneration,
    targetGeneration: pendingTransfer.targetGeneration,
  },
  credentialStage: credentialStage('transfer', verifiedTransfer.id, 'host-device-2', 2),
});
const transferReceipt = localReceipt(verifiedTransfer, actor('host-device-2'), 'transfer', validManifest);
for (const [field, wrongValue] of [
  ['id', 'wrong-transfer'],
  ['sourceEpochId', 'wrong-source-epoch'],
  ['challengeId', 'wrong-challenge'],
]) {
  const mismatched = {
    ...validManifest,
    transfer: { ...validManifest.transfer, [field]: wrongValue },
  };
  assert.throws(
    () => service.activateTransfer({
      actorContext: actor('host-device-2'), transferId: pendingTransfer.id,
      expectedTransferRowVersion: pendingTransfer.rowVersion,
      localReceipt: localReceipt(verifiedTransfer, actor('host-device-2'), 'transfer', mismatched),
      validationManifest: mismatched,
    }),
    error => error?.code === 'PRIMARY_HOST_TRANSFER_MANIFEST_MISMATCH',
    `transfer ${field} must be bound to the exact pending row`
  );
}
for (const [name, manifest, code] of [
  ['backup', { ...validManifest, backup: { ...validManifest.backup, authoritative: false } }, 'PRIMARY_HOST_BACKUP_NOT_AUTHORITATIVE'],
  ['quick_check', { ...validManifest, database: { ...validManifest.database, quickCheck: 'corrupt' } }, 'PRIMARY_HOST_SQLITE_QUICK_CHECK_FAILED'],
  ['schema', { ...validManifest, database: { ...validManifest.database, schemaVersion: 3105 } }, 'PRIMARY_HOST_SCHEMA_MISMATCH'],
  ['store', { ...validManifest, questionBank: { ...validManifest.questionBank, storeId: 'wrong-store' } }, 'PRIMARY_HOST_STORE_MISMATCH'],
  ['authority', { ...validManifest, questionBank: { ...validManifest.questionBank, dbAuthorityId: 'wrong-authority' } }, 'PRIMARY_HOST_AUTHORITY_MISMATCH'],
  ['cloud', { ...validManifest, cloudPreflight: { ...validManifest.cloudPreflight, status: 'failed' } }, 'PRIMARY_HOST_CLOUD_PREFLIGHT_FAILED'],
  ['sync', { ...validManifest, localPreflight: { ...validManifest.localPreflight, status: 'failed' } }, 'PRIMARY_HOST_LOCAL_PREFLIGHT_FAILED'],
]) {
  assert.throws(
    () => service.activateTransfer({
      actorContext: actor('host-device-2'), transferId: pendingTransfer.id,
      expectedTransferRowVersion: pendingTransfer.rowVersion,
      localReceipt: transferReceipt, validationManifest: manifest,
    }),
    error => error?.code === code,
    name
  );
  assert.strictEqual(service.getActiveEpoch().generation, 1, `${name} failure must preserve generation 1`);
}
assert.throws(
  () => service.activateTransfer({
    actorContext: actor('host-device-2'), transferId: pendingTransfer.id,
    expectedTransferRowVersion: pendingTransfer.rowVersion,
    localReceipt: transferReceipt,
    validationManifest: { ...validManifest, attestationTamper: true },
    preflightProof: { id: 'transfer-proof-id', token: 'transfer-proof' },
    recoveryDeliveryKey: recoveryDeliveryPublicKey('transfer'),
  }),
  error => error?.code === 'PRIMARY_HOST_PREFLIGHT_PROOF_CONTEXT_MISMATCH'
);

const activatedTransfer = service.activateTransfer({
  actorContext: actor('host-device-2'),
  transferId: pendingTransfer.id,
  expectedTransferRowVersion: pendingTransfer.rowVersion,
  localReceipt: transferReceipt,
  validationManifest: validManifest,
  preflightProof: { id: 'transfer-proof-id', token: 'transfer-proof' },
  recoveryDeliveryKey: recoveryDeliveryPublicKey('transfer'),
});
assert.strictEqual(activatedTransfer.epoch.generation, 2);
assert.strictEqual(activatedTransfer.epoch.deviceId, 'host-device-2');
assert.strictEqual(
  activatedTransfer.epoch.hostPublicKey,
  credentialStage('transfer', verifiedTransfer.id, 'host-device-2', 2)
    .hostSigningKey.publicKeyPem
);
assert.strictEqual(Object.hasOwn(activatedTransfer, 'hostCredential'), false);
assert.strictEqual(Object.hasOwn(activatedTransfer, 'recoveryPackage'), false);
const transferRecoveryPackage = decryptRecoveryDelivery(
  activatedTransfer,
  'transfer',
  'host-device-2'
);
const repeatedTransfer = service.activateTransfer({
  actorContext: actor('host-device-2'),
  transferId: pendingTransfer.id,
  expectedTransferRowVersion: pendingTransfer.rowVersion,
  localReceipt: transferReceipt,
  validationManifest: validManifest,
  preflightProof: { id: 'transfer-proof-id', token: 'transfer-proof' },
  recoveryDeliveryKey: recoveryDeliveryPublicKey('transfer'),
});
assert.strictEqual(repeatedTransfer.epoch.id, activatedTransfer.epoch.id);
assert.strictEqual(repeatedTransfer.recoveryDelivery.id, activatedTransfer.recoveryDelivery.id);
assert.strictEqual(db.prepare('SELECT status FROM primary_host_epochs WHERE generation=1').get().status, 'retired');
assert.throws(
  () => service.assertActiveHostCredential({
    deviceId: 'host-device-1', generation: 1, credential: stagedHostCredentials.bootstrap,
  }),
  error => error?.code === 'PRIMARY_HOST_EPOCH_RETIRED'
);
assert.strictEqual(service.assertActiveHostCredential({
  deviceId: 'host-device-2', generation: 2, credential: stagedHostCredentials.transfer,
}).generation, 2);
assert.strictEqual(
  acknowledgeRecoveryDelivery(activatedTransfer, 'transfer', actor('host-device-2')).status,
  'acknowledged'
);

currentTime = '2026-07-18T00:25:00.000Z';
db.prepare(`INSERT INTO host_heartbeats
  (id,host_device_id,status,base_url,created_at,updated_at)
  VALUES ('host-device-2','host-device-2','online','',?,?)`).run(
  '2026-07-18T00:05:00.000Z', '2026-07-18T00:05:00.000Z'
);
const recoveryChallenge = service.startOperationChallenge({
  actorContext: actor('host-device-1'), operation: 'recovery', targetDeviceId: 'host-device-1',
});
const verifiedRecovery = verifyPhone(recoveryChallenge, 'host-login-recovery');
const validRecovery = recoveryEvidence({
  credentialStage: credentialStage('recovery', verifiedRecovery.id, 'host-device-1', 3),
});
const recoveryReceipt = localReceipt(verifiedRecovery, actor('host-device-1'), 'recovery', validRecovery);
for (const [name, evidence, code] of [
  ['backup', recoveryEvidence({ authoritativeBackup: { ...validRecovery.authoritativeBackup, authoritative: false } }), 'PRIMARY_HOST_BACKUP_NOT_AUTHORITATIVE'],
  ['quick_check', recoveryEvidence({ database: { ...validRecovery.database, quickCheck: 'corrupt' } }), 'PRIMARY_HOST_SQLITE_QUICK_CHECK_FAILED'],
  ['schema', recoveryEvidence({ database: { ...validRecovery.database, schemaVersion: 3105 } }), 'PRIMARY_HOST_SCHEMA_MISMATCH'],
  ['store', recoveryEvidence({ questionBank: { ...validRecovery.questionBank, storeId: 'wrong-store' } }), 'PRIMARY_HOST_STORE_MISMATCH'],
  ['authority', recoveryEvidence({ questionBank: { ...validRecovery.questionBank, dbAuthorityId: 'wrong-authority' } }), 'PRIMARY_HOST_AUTHORITY_MISMATCH'],
]) {
  assert.throws(
    () => service.recover({
      actorContext: actor('host-device-1'), challengeId: verifiedRecovery.id,
      expectedChallengeRowVersion: verifiedRecovery.rowVersion,
      factorId: transferRecoveryPackage.factorId,
      recoveryCode: transferRecoveryPackage.recoveryCode,
      localReceipt: recoveryReceipt,
      evidence,
    }),
    error => error?.code === code,
    name
  );
  assert.strictEqual(service.getActiveEpoch().generation, 2, `${name} failure must preserve generation 2`);
}

db.prepare("UPDATE host_heartbeats SET status='online',updated_at=? WHERE host_device_id='host-device-2'")
  .run(currentTime);
const forgedOfflineEvidence = recoveryEvidence({ oldHostUnreachable: {
  generation: 2, consecutiveFailures: 999, durationMs: 365 * 24 * 60 * 60 * 1000,
  observedAt: currentTime,
} });
assert.throws(
  () => service.recover({
    actorContext: actor('host-device-1'), challengeId: verifiedRecovery.id,
    expectedChallengeRowVersion: verifiedRecovery.rowVersion,
    factorId: transferRecoveryPackage.factorId,
    recoveryCode: transferRecoveryPackage.recoveryCode,
    localReceipt: localReceipt(verifiedRecovery, actor('host-device-1'), 'recovery', forgedOfflineEvidence),
    evidence: forgedOfflineEvidence,
  }),
  error => error?.code === 'PRIMARY_HOST_OLD_HOST_STILL_REACHABLE',
  'client-signed duration/failure claims must not override a fresh server heartbeat'
);
db.prepare("UPDATE host_heartbeats SET status='online',updated_at='2026-07-18T00:05:00.000Z' WHERE host_device_id='host-device-2'").run();

assert.throws(
  () => service.recover({
    actorContext: actor('host-device-1'), challengeId: verifiedRecovery.id,
    expectedChallengeRowVersion: verifiedRecovery.rowVersion,
    factorId: transferRecoveryPackage.factorId,
    recoveryCode: 'wrong-recovery-code',
    localReceipt: recoveryReceipt,
    evidence: validRecovery,
    preflightProof: { id: 'recovery-proof-id', token: 'recovery-proof' },
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_FACTOR_INVALID'
);

randomBytesHook = () => db.prepare(
  "UPDATE host_heartbeats SET status='online',updated_at=? WHERE host_device_id='host-device-2'"
).run(currentTime);
assert.throws(
  () => service.recover({
    actorContext: actor('host-device-1'),
    challengeId: verifiedRecovery.id,
    expectedChallengeRowVersion: verifiedRecovery.rowVersion,
    factorId: transferRecoveryPackage.factorId,
    recoveryCode: transferRecoveryPackage.recoveryCode,
    localReceipt: recoveryReceipt,
    evidence: validRecovery,
    recoveryDeliveryKey: recoveryDeliveryPublicKey('recovery'),
  }),
  error => error?.code === 'PRIMARY_HOST_OLD_HOST_HEARTBEAT_CHANGED',
  'a heartbeat renewed after preflight but before retirement must abort recovery'
);
db.prepare("UPDATE host_heartbeats SET status='online',updated_at='2026-07-18T00:05:00.000Z' WHERE host_device_id='host-device-2'").run();

const recovered = service.recover({
  actorContext: actor('host-device-1'),
  challengeId: verifiedRecovery.id,
  expectedChallengeRowVersion: verifiedRecovery.rowVersion,
  factorId: transferRecoveryPackage.factorId,
  recoveryCode: transferRecoveryPackage.recoveryCode,
  localReceipt: recoveryReceipt,
  evidence: validRecovery,
  preflightProof: { id: 'recovery-proof-id', token: 'recovery-proof' },
  recoveryDeliveryKey: recoveryDeliveryPublicKey('recovery'),
});
assert.strictEqual(recovered.epoch.generation, 3);
assert.strictEqual(recovered.epoch.deviceId, 'host-device-1');
assert.strictEqual(Object.hasOwn(recovered, 'hostCredential'), false);
assert.strictEqual(Object.hasOwn(recovered, 'recoveryPackage'), false);
const recoveredPackage = decryptRecoveryDelivery(recovered, 'recovery', 'host-device-1');
assert.strictEqual(recoveredPackage.epochId, recovered.epoch.id);
assert.strictEqual(service.assertActiveHostCredential({
  deviceId: 'host-device-1', generation: 3, credential: stagedHostCredentials.recovery,
}).generation, 3);
assert.strictEqual(db.prepare('SELECT status FROM host_recovery_factors WHERE id=?').get(
  transferRecoveryPackage.factorId
).status, 'used');
const repeatedRecovery = service.recover({
  actorContext: actor('host-device-1'), challengeId: verifiedRecovery.id,
  expectedChallengeRowVersion: verifiedRecovery.rowVersion + 1,
  factorId: transferRecoveryPackage.factorId,
  recoveryCode: transferRecoveryPackage.recoveryCode,
  localReceipt: recoveryReceipt,
  evidence: validRecovery,
  preflightProof: { id: 'recovery-proof-id', token: 'recovery-proof' },
  recoveryDeliveryKey: recoveryDeliveryPublicKey('recovery'),
});
assert.strictEqual(repeatedRecovery.epoch.id, recovered.epoch.id);
assert.strictEqual(repeatedRecovery.recoveryDelivery.id, recovered.recoveryDelivery.id);
assert.strictEqual(service.getStatus(actor('host-device-1')).pendingRecoveryDelivery.id, recovered.recoveryDelivery.id);

const activeRows = db.prepare("SELECT * FROM primary_host_epochs WHERE status='active'").all();
assert.strictEqual(activeRows.length, 1);
assert.strictEqual(activeRows[0].generation, 3);
assert.strictEqual(db.prepare("SELECT subject_id FROM user_role_grants WHERE user_id=? AND role='teacher'").get(
  CANONICAL_SUPER_ADMIN_ID
).subject_id, 'teacher-owner', 'host duty must not replace the owner teacher binding');

let bootstrapCandidateForwarded = false;
const bootstrapCandidateService = createPrimaryHostIdentityService({
  db,
  localEvidenceProvider: input => {
    bootstrapCandidateForwarded = input.bootstrapCandidateVerified === true;
    return {
      ...authorityByDevice.get('host-device-1'),
      runtimeNodeRole: bootstrapCandidateForwarded ? 'primary-host' : 'desktop-client',
    };
  },
});
const bootstrapCandidateEvidence = bootstrapCandidateService.collectLocalEvidence({
  deviceId: 'host-device-1',
  purpose: 'bootstrap',
  bootstrapCandidateVerified: true,
});
assert.strictEqual(bootstrapCandidateForwarded, true,
  'verified bootstrap candidate must reach the local evidence provider');
assert.strictEqual(bootstrapCandidateEvidence.runtimeNodeRole, 'primary-host');

db.close();
console.log('primary host identity service checks passed');
