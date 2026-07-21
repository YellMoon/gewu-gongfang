const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  createPrimaryHostPreflightProofService,
} = require('./primaryHostPreflightProofService');
const {
  PHYSICAL_CONFIRMATION,
  createPrimaryHostLocalReceipt,
  primaryHostOperationManifestHash,
  primaryHostReceiptSigningPayload,
} = require('./primaryHostReceiptProtocol');

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
for (const [name, ddl] of [
  ['attempt', 'INTEGER NOT NULL DEFAULT 0'],
  ['max_attempts', 'INTEGER NOT NULL DEFAULT 3'],
  ['next_attempt_at', 'TEXT'],
  ['deadline_at', 'TEXT'],
]) {
  if (!db.prepare('PRAGMA table_info(miniapp_tasks)').all().some(column => column.name === name)) {
    db.exec(`ALTER TABLE miniapp_tasks ADD COLUMN ${name} ${ddl}`);
  }
}

let currentTime = '2026-07-18T08:00:00.000Z';
let idSequence = 0;
const now = () => new Date(currentTime);
const keyPair = crypto.generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const actor = {
  userId: 'proof-user', deviceId: 'proof-target', authorizationId: 'proof-authorization',
  sessionId: 'proof-session', activeRole: 'super_admin', eligibleRoles: ['super_admin'],
  authVersion: 4, credentialVersion: 7,
};

db.prepare(`INSERT INTO users
  (id,phone,name,role,status,login_enabled,review_status,auth_version,is_super_admin_identity,deleted,created_at,updated_at)
  VALUES ('proof-user','13000000001','Proof User','super_admin',1,1,'approved',4,1,0,?,?)`).run(currentTime, currentTime);
db.prepare(`INSERT INTO user_role_grants
  (user_id,role,status,source,created_at,updated_at)
  VALUES ('proof-user','super_admin','active','proof-test',?,?)`).run(currentTime, currentTime);
db.prepare(`INSERT INTO desktop_device_authorizations
  (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,source_challenge_id,
   last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,created_at,updated_at)
  VALUES ('proof-authorization','proof-target','Proof Target','desktop-client','proof-user',?,?,'active',
    'proof-source',?,'2026-08-18T08:00:00.000Z',7,3,?,?)`)
  .run(publicKey, crypto.createHash('sha256').update('proof-public-key').digest('hex'), currentTime, currentTime, currentTime);
db.prepare(`INSERT INTO desktop_device_authorizations
  (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,source_challenge_id,
   last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,created_at,updated_at)
  VALUES ('proof-source-authorization','proof-source-device','Proof Source','primary-host','proof-user',?,?,'active',
    'proof-source-host',?,'2026-08-18T08:00:00.000Z',1,1,?,?)`)
  .run(publicKey, crypto.createHash('sha256').update('proof-source-public-key').digest('hex'), currentTime, currentTime, currentTime);
db.prepare(`INSERT INTO desktop_sessions
  (sid,user_id,device_id,authorization_id,active_role,eligible_roles_json,auth_version,credential_version,
   status,issued_at,expires_at,row_version,created_at,updated_at)
  VALUES ('proof-session','proof-user','proof-target','proof-authorization','super_admin','["super_admin"]',
    4,7,'active',?,'2026-07-18T09:00:00.000Z',5,?,?)`).run(currentTime, currentTime, currentTime);
db.prepare(`INSERT INTO primary_host_operation_challenges
  (id,operation,requested_by_user_id,requested_by_device_id,target_device_id,status,verified_user_id,
   phone_verified_at,expires_at,row_version,created_at,updated_at,consumed_at)
  VALUES ('proof-challenge','transfer','proof-user','proof-source-device','proof-target','consumed','proof-user',
    ?, '2026-07-18T08:30:00.000Z',3,?,?,?)`).run(currentTime, currentTime, currentTime, currentTime);
db.prepare(`INSERT INTO primary_host_operation_challenges
  (id,operation,requested_by_user_id,requested_by_device_id,target_device_id,status,verified_user_id,
   phone_verified_at,expires_at,row_version,created_at,updated_at,consumed_at)
  VALUES ('proof-bootstrap-challenge','bootstrap','proof-user','proof-source-device','proof-source-device',
    'consumed','proof-user',?,'2026-07-18T08:30:00.000Z',3,?,?,?)`)
  .run(currentTime, currentTime, currentTime, currentTime);
db.prepare(`INSERT INTO primary_host_epochs
  (id,generation,device_id,user_id,authorization_id,status,activation_reason,challenge_id,db_instance_digest,
   schema_version,store_id,db_authority_id,host_credential_hash,credential_version,row_version,created_at,updated_at,activated_at)
  VALUES ('proof-epoch',1,'proof-source-device','proof-user','proof-source-authorization','active','bootstrap',
    'proof-bootstrap-challenge',?,3107,'proof-store','proof-authority',?,1,6,?,?,?)`)
  .run('a'.repeat(64), 'b'.repeat(64), currentTime, currentTime, currentTime);
db.prepare(`INSERT INTO host_transfers
  (id,source_epoch_id,source_generation,target_generation,target_device_id,user_id,challenge_id,status,row_version,created_at,updated_at)
  VALUES ('proof-transfer','proof-epoch',1,2,'proof-target','proof-user','proof-challenge','pending_validation',2,?,?)`)
  .run(currentTime, currentTime);

const manifest = {
  transfer: {
    id: 'proof-transfer', sourceEpochId: 'proof-epoch', challengeId: 'proof-challenge',
    targetDeviceId: 'proof-target', sourceGeneration: 1, targetGeneration: 2,
  },
  localPreflight: {
    status: 'ok', tablesChecked: 17,
    actor: { userId: 'proof-user', deviceId: 'proof-target', sessionId: 'proof-session' },
  },
};
const receipt = createPrimaryHostLocalReceipt({
  operation: 'transfer',
  challengeId: 'proof-challenge',
  identity: actor,
  evidence: {
    runtimeNodeRole: 'desktop-client', dbInstanceDigest: 'c'.repeat(64), schemaVersion: 3107,
    storeId: 'proof-store', dbAuthorityId: 'proof-authority', quickCheck: 'ok',
  },
  physicalConfirmation: PHYSICAL_CONFIRMATION,
  operationManifest: manifest,
  now,
});
const localReceipt = {
  receipt,
  signature: crypto.sign(
    null,
    Buffer.from(primaryHostReceiptSigningPayload(receipt), 'utf8'),
    keyPair.privateKey
  ).toString('base64'),
};
const service = createPrimaryHostPreflightProofService({
  db,
  now,
  uuid: () => `proof-${++idSequence}`,
  randomBytes: size => Buffer.alloc(size, idSequence + 1),
});

function context(overrides = {}) {
  return {
    actorContext: actor,
    operation: 'transfer',
    challengeId: 'proof-challenge',
    transferId: 'proof-transfer',
    sourceEpochId: 'proof-epoch',
    sourceGeneration: 1,
    targetGeneration: 2,
    operationManifest: manifest,
    localReceipt,
    ...overrides,
  };
}

const taskRowsBefore = db.prepare('SELECT COUNT(*) count FROM miniapp_tasks').get().count;
const issued = service.issue(context());
assert.strictEqual(issued.cloudPreflight.status, 'ok');
assert.strictEqual(issued.cloudPreflight.protocolVersion, 2);
assert.deepStrictEqual(issued.operationManifest.cloudPreflight, issued.cloudPreflight,
  'the cloud must append its actual read preview to the final manifest');
assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM miniapp_tasks').get().count, taskRowsBefore,
  'issuing a proof must not claim or mutate relay tasks');
assert.strictEqual(db.prepare('SELECT COUNT(*) count FROM primary_host_preflight_proofs').get().count, 1,
  'the only persisted state is the one-time proof');

assert.throws(
  () => service.consume(context({
    preflightProof: { id: issued.id, token: 'forged-proof-token' },
    operationManifest: issued.operationManifest,
  })),
  error => error.code === 'PRIMARY_HOST_PREFLIGHT_PROOF_INVALID'
);
db.prepare("UPDATE desktop_device_authorizations SET row_version=4 WHERE id='proof-authorization'").run();
assert.throws(
  () => service.consume(context({ preflightProof: issued, operationManifest: issued.operationManifest })),
  error => error.code === 'PRIMARY_HOST_PREFLIGHT_PROOF_CONTEXT_MISMATCH'
);
db.prepare("UPDATE desktop_device_authorizations SET row_version=3 WHERE id='proof-authorization'").run();
assert.throws(
  () => service.consume(context({
    preflightProof: issued,
    operationManifest: { ...issued.operationManifest, tampered: true },
  })),
  error => error.code === 'PRIMARY_HOST_PREFLIGHT_PROOF_CONTEXT_MISMATCH'
);

const expiring = service.issue(context());
currentTime = '2026-07-18T08:03:00.000Z';
assert.throws(
  () => service.consume(context({ preflightProof: expiring, operationManifest: expiring.operationManifest })),
  error => error.code === 'PRIMARY_HOST_PREFLIGHT_PROOF_EXPIRED'
);

currentTime = '2026-07-18T08:00:30.000Z';
const oneTime = service.issue(context());
const consumed = service.consume(context({
  preflightProof: oneTime,
  operationManifest: oneTime.operationManifest,
}));
assert.strictEqual(consumed.manifestHash, primaryHostOperationManifestHash(oneTime.operationManifest));
assert.throws(
  () => service.consume(context({ preflightProof: oneTime, operationManifest: oneTime.operationManifest })),
  error => error.code === 'PRIMARY_HOST_PREFLIGHT_PROOF_REPLAYED'
);

db.close();
console.log('primary host preflight proof service checks passed');
