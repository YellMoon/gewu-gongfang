const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { digest, stableJson } = require('./authorityCommandService');
const {
  bindQuestionBankStoreToDatabase,
  commitQuestionToBoundStore,
  createTrustedAuthorityExecutorStorageContext,
  deleteCommittedQuestion,
  initQuestionBankStore,
  recoverAuthorityQuestionStorageOperations,
  updateCommittedQuestion,
} = require('./questionBankStorageService');
const questionBank = require('./questionBankService');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-question-command-'));
const dbPath = path.join(workspace, 'authority-copy.db');
const storeRoot = path.join(workspace, 'question-store-copy');
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
let database;
try {
  process.env.DB_PATH = dbPath;
  delete process.env.READ_DB_PATH;
  process.env.NODE_ENV = 'test';
  const { DatabaseService } = require('../database');
  const { createAuthorityHostRuntime } = require('./authorityHostRuntime');
  database = new DatabaseService();
  const db = database.db;
  const timestamp = '2026-07-28T00:00:00.000Z';
  db.prepare(`INSERT INTO users
    (id,name,role,status,created_at,updated_at)
    VALUES('admin-1','Authority Admin','admin','active',?,?)`).run(timestamp, timestamp);

  initQuestionBankStore(storeRoot, { deviceId: 'host-device' });
  const binding = bindQuestionBankStoreToDatabase({
    db,
    root: storeRoot,
    authz: {
      role: 'super_admin',
      userId: 'admin-1',
      userApproved: true,
      deviceTrusted: true,
      deviceActive: true,
      deviceOwnerUserId: 'admin-1',
      isPrimaryHost: true,
    },
    runtime: {
      nodeRole: 'primary-host',
      clientType: 'desktop',
      tokenUse: 'desktop-session',
      deviceId: 'host-device',
      tokenDeviceId: 'host-device',
    },
  });

  db.prepare(`INSERT INTO desktop_device_authorizations
    (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,
     source_challenge_id,authorization_source,approved_by_user_id,approved_by_device_id,
     approved_at,last_phone_verified_at,phone_reverify_due_at,credential_version,
     row_version,created_at,updated_at)
    VALUES('authorization-1','host-device','Authority Host','primary-host','admin-1',
      'host-public-key','host-fingerprint','active','identity-challenge-1',
      'wechat_phone','admin-1','host-device',?,?, '2027-07-28T00:00:00.000Z',1,1,?,?)`)
    .run(timestamp, timestamp, timestamp, timestamp);
  db.prepare(`INSERT INTO primary_host_operation_challenges
    (id,operation,requested_by_user_id,requested_by_device_id,target_device_id,
     status,verified_user_id,phone_verified_at,expires_at,row_version,created_at,
     updated_at,consumed_at)
    VALUES('challenge-1','bootstrap','admin-1','host-device','host-device',
      'consumed','admin-1',?,'2027-07-28T00:00:00.000Z',1,?,?,?)`)
    .run(timestamp, timestamp, timestamp, timestamp);
  db.prepare(`INSERT INTO primary_host_epochs
    (id,generation,device_id,user_id,authorization_id,status,activation_reason,
     source_epoch_id,challenge_id,db_instance_digest,schema_version,store_id,
     db_authority_id,host_credential_hash,host_public_key,credential_version,
     row_version,created_at,updated_at,activated_at)
    VALUES('epoch-1',1,'host-device','admin-1','authorization-1','active','bootstrap',
      NULL,'challenge-1','digest',1,? ,?,'credential-hash',NULL,1,1,?,?,?)`)
    .run(binding.storeId, binding.dbAuthorityId, timestamp, timestamp, timestamp);
  db.prepare(`INSERT INTO device_grants
    (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,
     grant_version,approved_by,created_at,updated_at)
    VALUES('grant-1',?,'ordinary-device','admin-1','device-public-key',1,'active',
      1,'admin-1',?,?)`).run(binding.dbAuthorityId, timestamp, timestamp);
  db.prepare(`INSERT INTO device_leases
    (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,
     status,issued_at,expires_at,revoked_at)
    VALUES('lease-1','grant-1',?,'ordinary-device','admin-1','admin',1,
      'active',?,'2026-07-29T00:00:00.000Z',NULL)`)
    .run(binding.dbAuthorityId, timestamp);
  db.prepare(`INSERT INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at)
    VALUES('admin-1',?,'active',?,?)`)
    .run(binding.dbAuthorityId, timestamp, timestamp);
  db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,
     grant_version,granted_by,created_at,updated_at)
    VALUES('role-1',?,'admin-1','admin',NULL,NULL,'active',1,'bootstrap',?,?)`)
    .run(binding.dbAuthorityId, timestamp, timestamp);

  const runtime = createAuthorityHostRuntime({
    database,
    targetHostId: 'host-device',
    now: () => timestamp,
    commandSource: {
      claim: async () => [],
      renew: async () => ({ renewed: true }),
      publishReceipt: async () => ({ published: true }),
    },
  });
  function envelope({ commandId, type, payload }) {
    return {
      protocol: 'gewu.authority-command.v1',
      commandId,
      idempotencyKey: `idempotency-${commandId}`,
      authorityId: binding.dbAuthorityId,
      hostEpochId: 'epoch-1',
      actor: { userId: 'admin-1', deviceId: 'ordinary-device', role: 'admin' },
      lease: { id: 'lease-1', grantVersion: 1 },
      type,
      payload,
      payloadHash: digest(stableJson(payload)),
      createdAt: timestamp,
    };
  }

  const crashEnvelope = envelope({
    commandId: 'question-crash-command',
    type: 'question.create.v1',
    payload: { record: { id: 'question-crash-1' } },
  });
  const crashCredential = createTrustedAuthorityExecutorStorageContext({
    envelope: crashEnvelope,
    authorization: {
      authorityId: binding.dbAuthorityId,
      hostEpochId: 'epoch-1',
      hostDeviceId: 'host-device',
      scope: { kind: 'admin', userId: 'admin-1' },
    },
  });
  const crashingTransaction = db.transaction(() => {
    questionBank.createQuestion(db, {
      id: 'question-crash-1',
      subject: 'Physics',
      type: 'single',
      content: 'crash window',
      answer: 'test',
      status: 'draft',
    }, 'default', { deviceId: 'ordinary-device', userId: 'admin-1' });
    commitQuestionToBoundStore('question-crash-1', {
      db,
      tenantId: 'default',
      operationId: crashEnvelope.commandId,
      internalCredential: crashCredential,
    });
    throw Object.assign(new Error('simulated power loss before ledger commit'), {
      code: 'SIMULATED_POWER_LOSS',
    });
  });
  assert.throws(() => crashingTransaction(), /simulated power loss/);
  assert.strictEqual(
    fs.existsSync(path.join(storeRoot, 'questions', 'question-crash-1', 'question.json')),
    true,
    'the fixture must reproduce a filesystem write that survived the rolled-back SQLite transaction',
  );
  const recoveredOperations = recoverAuthorityQuestionStorageOperations({ db });
  assert.strictEqual(recoveredOperations.rolledBack, 1);
  assert.strictEqual(
    fs.existsSync(path.join(storeRoot, 'questions', 'question-crash-1')),
    false,
    'startup recovery must remove the uncommitted question directory',
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(storeRoot, 'manifest.json'), 'utf8')).questions?.['question-crash-1'],
    undefined,
  );

  const createEnvelope = envelope({
    commandId: 'question-create-command',
    type: 'question.create.v1',
    payload: {
      record: {
        id: 'question-command-1',
        subject: 'Physics',
        type: 'single',
        content: '1+1?',
        options: ['1', '2'],
        answer: '2',
        status: 'published',
      },
    },
  });
  const created = runtime.executor.execute(createEnvelope);
  assert.strictEqual(created.receipt.result.storageState, 'host_committed');
  assert.strictEqual(
    db.prepare('SELECT storage_state FROM questions WHERE id=?').get('question-command-1').storage_state,
    'host_committed',
  );
  assert.strictEqual(
    fs.existsSync(path.join(storeRoot, 'questions', 'question-command-1', 'question.json')),
    true,
  );
  assert.strictEqual(runtime.executor.execute(createEnvelope).replayed, true);
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) AS count FROM authority_command_ledger WHERE command_id='question-create-command'").get().count,
    1,
  );

  const updated = runtime.executor.execute(envelope({
    commandId: 'question-update-command',
    type: 'question.update.v1',
    payload: {
      id: 'question-command-1',
      changes: { analysis: 'host executor update' },
    },
  }));
  assert.strictEqual(updated.receipt.status, 'committed');
  const storedBundle = JSON.parse(
    fs.readFileSync(
      path.join(storeRoot, 'questions', 'question-command-1', 'question.json'),
      'utf8',
    ),
  );
  assert.strictEqual(
    storedBundle.contents.some(content => content.explanation === 'host executor update'),
    true,
  );

  const stableBundle = fs.readFileSync(path.join(storeRoot, 'questions', 'question-command-1', 'question.json'), 'utf8');
  const updateCrashEnvelope = envelope({
    commandId: 'question-update-crash-command', type: 'question.update.v1',
    payload: { id: 'question-command-1', changes: { analysis: 'must rollback' } },
  });
  const updateCrashCredential = createTrustedAuthorityExecutorStorageContext({
    envelope: updateCrashEnvelope,
    authorization: { authorityId: binding.dbAuthorityId, hostEpochId: 'epoch-1', hostDeviceId: 'host-device', scope: { kind: 'admin', userId: 'admin-1' } },
  });
  assert.throws(() => db.transaction(() => {
    updateCommittedQuestion('question-command-1', { db, tenantId: 'default', payload: { analysis: 'must rollback' }, operationId: updateCrashEnvelope.commandId, internalCredential: updateCrashCredential });
    throw new Error('simulated update power loss');
  })(), /simulated update power loss/);
  assert.notStrictEqual(fs.readFileSync(path.join(storeRoot, 'questions', 'question-command-1', 'question.json'), 'utf8'), stableBundle);
  assert.strictEqual(recoverAuthorityQuestionStorageOperations({ db }).rolledBack, 1);
  assert.strictEqual(fs.readFileSync(path.join(storeRoot, 'questions', 'question-command-1', 'question.json'), 'utf8'), stableBundle);

  const deleteCrashEnvelope = envelope({ commandId: 'question-delete-crash-command', type: 'question.delete.v1', payload: { id: 'question-command-1' } });
  const deleteCrashCredential = createTrustedAuthorityExecutorStorageContext({
    envelope: deleteCrashEnvelope,
    authorization: { authorityId: binding.dbAuthorityId, hostEpochId: 'epoch-1', hostDeviceId: 'host-device', scope: { kind: 'admin', userId: 'admin-1' } },
  });
  assert.throws(() => db.transaction(() => {
    deleteCommittedQuestion('question-command-1', { db, tenantId: 'default', operationId: deleteCrashEnvelope.commandId, internalCredential: deleteCrashCredential });
    throw new Error('simulated delete power loss');
  })(), /simulated delete power loss/);
  assert.strictEqual(fs.existsSync(path.join(storeRoot, 'questions', 'question-command-1')), false);
  assert.strictEqual(recoverAuthorityQuestionStorageOperations({ db }).rolledBack, 1);
  assert.strictEqual(fs.existsSync(path.join(storeRoot, 'questions', 'question-command-1', 'question.json')), true);

  const deleted = runtime.executor.execute(envelope({
    commandId: 'question-delete-command',
    type: 'question.delete.v1',
    payload: { id: 'question-command-1' },
  }));
  assert.strictEqual(deleted.receipt.result.deleted, true);
  assert.strictEqual(
    fs.existsSync(
      path.join(storeRoot, '.trash', 'question-delete-command', 'question-command-1', 'question.json'),
    ),
    true,
  );

  console.log('authorityQuestionCommandIntegration tests passed');
} finally {
  if (database) database.close();
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(workspace, { recursive: true, force: true });
}
