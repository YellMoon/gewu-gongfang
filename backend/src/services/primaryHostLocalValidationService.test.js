const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createPrimaryHostLocalValidationService } = require('./primaryHostLocalValidationService');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-primary-host-local-validation-'));
  const sourcePath = path.join(root, 'authoritative-source.sqlite');
  const source = new Database(sourcePath);
  source.pragma('user_version = 3107');
  source.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  source.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
    VALUES ('database_authority_id','authority-1',?)`).run('2026-07-18T07:00:00.000Z');
  source.prepare(`INSERT INTO question_bank_store_bindings
    (store_id,db_authority_id,root_path,bound_by,bound_at,status)
    VALUES ('store-1','authority-1','question-bank','local-test',?,'active')`)
    .run('2026-07-18T07:00:00.000Z');
  source.prepare(`INSERT INTO users
    (id,phone,name,role,status,login_enabled,review_status,auth_version,deleted,created_at,updated_at)
    VALUES ('local-user','13000000001','Local User','super_admin',1,1,'approved',4,0,?,?)`)
    .run('2026-07-18T07:00:00.000Z', '2026-07-18T07:00:00.000Z');
  source.prepare(`INSERT INTO desktop_device_authorizations
    (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,source_challenge_id,
     last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,created_at,updated_at)
    VALUES ('local-authorization','target-b','Target B','desktop-client','local-user','public-key',?,'active',
      'local-source',?,'2026-08-18T07:00:00.000Z',7,1,?,?)`)
    .run('a'.repeat(64), '2026-07-18T07:00:00.000Z', '2026-07-18T07:00:00.000Z', '2026-07-18T07:00:00.000Z');
  source.prepare(`INSERT INTO desktop_sessions
    (sid,user_id,device_id,authorization_id,active_role,eligible_roles_json,auth_version,credential_version,
     status,issued_at,expires_at,row_version,created_at,updated_at)
    VALUES ('local-session','local-user','target-b','local-authorization','super_admin','["super_admin"]',
      4,7,'active',?,'2026-07-18T08:00:00.000Z',1,?,?)`)
    .run('2026-07-18T07:00:00.000Z', '2026-07-18T07:00:00.000Z', '2026-07-18T07:00:00.000Z');
  const actorContext = {
    userId: 'local-user', deviceId: 'target-b', authorizationId: 'local-authorization',
    sessionId: 'local-session', activeRole: 'super_admin', eligibleRoles: ['super_admin'],
    authVersion: 4, credentialVersion: 7,
  };
  const evidence = {
    runtimeNodeRole: 'desktop-client',
    dbInstanceDigest: 'a'.repeat(64),
    schemaVersion: 3107,
    storeId: 'store-1',
    dbAuthorityId: 'authority-1',
    quickCheck: 'ok',
  };
  const service = createPrimaryHostLocalValidationService({
    backupRoot: root,
    collectEvidence: ({ purpose }) => ({
      ...evidence,
      runtimeNodeRole: purpose === 'bootstrap' ? 'primary-host' : 'desktop-client',
    }),
    backupDatabase: destination => source.backup(destination),
    now: () => new Date('2026-07-18T07:00:00.000Z'),
    id: () => 'validation-id-1',
  });
  const bootstrap = await service.prepare({ operation: 'bootstrap', deviceId: 'host-a' });
  assert.strictEqual(bootstrap.evidence.runtimeNodeRole, 'primary-host');
  assert.strictEqual(bootstrap.localValidation.backup.authoritative, true);
  assert.strictEqual(bootstrap.localValidation.backup.quickCheck, 'ok');
  assert.strictEqual(bootstrap.localValidation.backup.storeId, 'store-1');
  assert.match(bootstrap.localValidation.backup.artifactName, /^primary-host-bootstrap-g1-/);
  assert.strictEqual(bootstrap.localValidation.localPreflight, null);

  const transfer = await service.prepare({
    operation: 'transfer', deviceId: 'target-b', sourceGeneration: 1, targetGeneration: 2,
    actorContext,
  });
  assert.strictEqual(transfer.evidence.deviceId, undefined);
  assert.strictEqual(transfer.localValidation.backup.authoritative, true);
  assert.strictEqual(transfer.localValidation.backup.sourceGeneration, 1);
  assert.match(transfer.localValidation.backup.sha256, /^[a-f0-9]{64}$/);
  assert.ok(transfer.localValidation.backup.sizeBytes > 0);
  assert.strictEqual(transfer.localValidation.backup.quickCheck, 'ok');
  assert.strictEqual(transfer.localValidation.backup.schemaVersion, 3107);
  assert.strictEqual(transfer.localValidation.backup.storeId, 'store-1');
  assert.strictEqual(transfer.localValidation.backup.dbAuthorityId, 'authority-1');
  assert.strictEqual(transfer.localValidation.localPreflight.status, 'ok');
  assert.strictEqual(transfer.localValidation.localPreflight.actor.sessionId, 'local-session');
  assert.ok(transfer.localValidation.localPreflight.tablesChecked >= 10);
  assert.ok(!Object.hasOwn(transfer.localValidation.backup, 'artifactPath'), 'cloud payload must not disclose local paths');
  assert.ok(fs.existsSync(path.join(root, transfer.localValidation.backup.artifactName)));

  const retentionRoot = path.join(root, 'retention');
  fs.mkdirSync(retentionRoot, { recursive: true });
  const staleArtifact = path.join(retentionRoot, 'primary-host-transfer-g1-stale.sqlite');
  const unrelatedArtifact = path.join(retentionRoot, 'keep-user-file.txt');
  fs.writeFileSync(staleArtifact, 'stale');
  fs.writeFileSync(unrelatedArtifact, 'keep');
  fs.utimesSync(staleArtifact, new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z'));
  let retainedId = 0;
  const retainedService = createPrimaryHostLocalValidationService({
    backupRoot: retentionRoot,
    collectEvidence: () => evidence,
    backupDatabase: destination => source.backup(destination),
    now: () => new Date('2026-07-18T07:00:00.000Z'),
    id: () => `retained-${++retainedId}`,
    backupRetentionMs: 7 * 24 * 60 * 60 * 1000,
    maxBackupArtifacts: 2,
  });
  for (let index = 0; index < 3; index += 1) {
    await retainedService.prepare({
      operation: 'transfer', deviceId: 'target-b', sourceGeneration: 1, targetGeneration: 2,
      actorContext,
    });
  }
  const retainedArtifacts = fs.readdirSync(retentionRoot)
    .filter(name => /^primary-host-(transfer|recovery)-g\d+-[A-Za-z0-9_-]+\.sqlite$/.test(name));
  assert.strictEqual(retainedArtifacts.length, 2, 'validation backup retention must cap plaintext artifacts');
  assert.ok(!fs.existsSync(staleArtifact), 'expired validation backups must be removed');
  assert.ok(fs.existsSync(unrelatedArtifact), 'retention must never remove unrelated user files');

  await assert.rejects(
    service.prepare({ operation: 'transfer', deviceId: 'target-b', sourceGeneration: 1, targetGeneration: 3 }),
    error => error.code === 'PRIMARY_HOST_LOCAL_GENERATION_INVALID'
  );
  const nonSqlite = createPrimaryHostLocalValidationService({
    backupRoot: path.join(root, 'non-sqlite'),
    collectEvidence: () => evidence,
    backupDatabase: async destination => fs.writeFileSync(destination, 'not a sqlite database', 'utf8'),
    id: () => 'non-sqlite',
  });
  await assert.rejects(
    nonSqlite.prepare({ operation: 'transfer', sourceGeneration: 1, targetGeneration: 2 }),
    error => error.code === 'PRIMARY_HOST_LOCAL_BACKUP_INVALID'
  );
  assert.deepStrictEqual(
    fs.readdirSync(path.join(root, 'non-sqlite')),
    [],
    'failed validation must delete its incomplete plaintext backup'
  );

  const malformedSqlite = createPrimaryHostLocalValidationService({
    backupRoot: path.join(root, 'malformed-sqlite'),
    collectEvidence: () => evidence,
    backupDatabase: async destination => fs.writeFileSync(
      destination,
      Buffer.concat([Buffer.from('SQLite format 3\0', 'binary'), Buffer.alloc(100, 0xff)])
    ),
    id: () => 'malformed-sqlite',
  });
  await assert.rejects(
    malformedSqlite.prepare({ operation: 'recovery', sourceGeneration: 1, targetGeneration: 2 }),
    error => error.code === 'PRIMARY_HOST_LOCAL_BACKUP_INVALID'
  );

  const missingAuthoritySource = new Database(path.join(root, 'missing-authority-source.sqlite'));
  missingAuthoritySource.pragma('user_version = 3107');
  missingAuthoritySource.exec('CREATE TABLE harmless (id INTEGER PRIMARY KEY)');
  const missingAuthority = createPrimaryHostLocalValidationService({
    backupRoot: path.join(root, 'missing-authority'),
    collectEvidence: () => evidence,
    backupDatabase: destination => missingAuthoritySource.backup(destination),
    id: () => 'missing-authority',
  });
  await assert.rejects(
    missingAuthority.prepare({ operation: 'transfer', sourceGeneration: 1, targetGeneration: 2 }),
    error => error.code === 'PRIMARY_HOST_LOCAL_BACKUP_AUTHORITY_INVALID'
  );
  missingAuthoritySource.close();
  source.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('primary host local validation service checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
