const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const serviceSource = fs.readFileSync(path.join(__dirname, 'authorityMigrationService.js'), 'utf8');
assert.doesNotMatch(serviceSource, /renameSync\(target,\s*rollback\)/,
  'atomic promotion must never move the live authority path away before the replacement is ready');
assert.match(serviceSource, /copyFileSync\(target, rollback, fs\.constants\.COPYFILE_EXCL\)/,
  'promotion must finish a separate rollback copy before atomically replacing the live authority path');
const {
  rehearseAuthorityMigration,
  promoteAuthorityCutover,
  hasAuthorityCutoverMarker,
} = require('./authorityMigrationService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-migration-service-'));
try {
  const source = path.join(root, 'source.db');
  const copy = path.join(root, 'copy.db');
  const db = new Database(source);
  db.exec(`CREATE TABLE users(
    id TEXT PRIMARY KEY, role TEXT, status INTEGER, login_enabled INTEGER,
    review_status TEXT, deleted INTEGER, teacher_id TEXT, student_id TEXT
  );
  CREATE TABLE user_role_grants (
    user_id TEXT NOT NULL, role TEXT NOT NULL, subject_type TEXT, subject_id TEXT,
    status TEXT NOT NULL, source TEXT, granted_by TEXT, created_at TEXT, updated_at TEXT, revoked_at TEXT
  );`);
  db.prepare("INSERT INTO users VALUES ('teacher-1','teacher',1,1,'approved',0,'teacher-record-1',NULL)").run();
  db.prepare("INSERT INTO users VALUES ('admin-1','admin',1,1,'approved',0,NULL,NULL)").run();
  db.prepare("INSERT INTO users VALUES ('super-1','super_admin',1,1,'approved',0,NULL,NULL)").run();
  db.prepare("INSERT INTO users VALUES ('visitor-1','visitor',1,1,'approved',0,NULL,NULL)").run();
  db.prepare("INSERT INTO users VALUES ('scalar-teacher','teacher',1,1,'approved',0,'scalar-teacher-record',NULL)").run();
  db.prepare("INSERT INTO users VALUES ('scalar-admin','admin',1,1,'approved',0,NULL,NULL)").run();
  db.prepare("INSERT INTO users VALUES ('scalar-super','super_admin',1,1,'approved',0,NULL,NULL)").run();
  const insertGrant = db.prepare(`INSERT INTO user_role_grants
    (user_id,role,subject_type,subject_id,status,source,granted_by,created_at,updated_at,revoked_at)
    VALUES (?,?,?,?, 'active','legacy',NULL,?,?,NULL)`);
  insertGrant.run('teacher-1', 'teacher', 'teacher', 'teacher-record-1',
    '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
  insertGrant.run('admin-1', 'admin', null, null,
    '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
  insertGrant.run('super-1', 'super_admin', null, null,
    '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
  db.close();

  const before = fs.readFileSync(source);
  assert.throws(() => rehearseAuthorityMigration({ sourceDb: source, copyDb: source }), /AUTHORITY_MIGRATION_COPY_PATH_INVALID/);
  const replayRequiredCopy = path.join(root, 'replay-required-copy.db');
  assert.throws(
    () => rehearseAuthorityMigration({ sourceDb: source, copyDb: replayRequiredCopy, authorityId: 'authority-test' }),
    /AUTHORITY_MIGRATION_COMMAND_REPLAY_REQUIRED/,
  );
  const report = rehearseAuthorityMigration({
    sourceDb: source,
    copyDb: copy,
    authorityId: 'authority-test',
    now: '2026-07-28T00:00:00.000Z',
    commandReplay: () => [],
  });
  assert.strictEqual(report.sourceFingerprintBefore, report.sourceFingerprintAfter);
  assert.deepStrictEqual(report.parityFailures, []);
  assert.deepStrictEqual(report.commandReplayFailures, []);
  assert.strictEqual(report.legacyRoutesSafeToRemove, true);
  assert.deepStrictEqual(fs.readFileSync(source), before, 'rehearsal must never mutate the source authority database');
  const copyDb = new Database(copy, { readonly: true });
  assert.strictEqual(copyDb.prepare("SELECT status FROM authority_role_bindings WHERE user_id='teacher-1'").get().status, 'active');
  assert.strictEqual(copyDb.prepare("SELECT status FROM authority_accounts WHERE user_id='visitor-1'").get().status, 'active',
    'a user without a formal role remains an active authority account whose role is derived as visitor');
  for (const userId of ['scalar-teacher', 'scalar-admin', 'scalar-super']) {
    assert.strictEqual(copyDb.prepare(`SELECT COUNT(*) AS count FROM authority_role_bindings
      WHERE user_id=? AND status='active'`).get(userId).count, 0,
    'users.role must never create an active canonical role binding without an active formal grant');
    assert.strictEqual(copyDb.prepare('SELECT status FROM authority_accounts WHERE user_id=?').get(userId).status, 'active',
      'an approved user without a formal grant remains an active visitor authority account');
  }
  assert.strictEqual(copyDb.prepare("SELECT name FROM authority_migration_ledger WHERE name='authority_protocol_v1_rehearsal'").get().name, 'authority_protocol_v1_rehearsal');
  copyDb.close();
  assert.strictEqual(report.copyFingerprint, require('./authorityMigrationService').fingerprint(copy),
    'the report must fingerprint the closed, checkpointed migration artifact after writing its rehearsal ledger');

  const metadataSource = path.join(root, 'metadata-source.db');
  fs.copyFileSync(source, metadataSource);
  const metadataDb = new Database(metadataSource);
  metadataDb.exec('CREATE TABLE authority_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);');
  metadataDb.prepare("INSERT INTO authority_metadata VALUES('database_authority_id','database-authority-1',?)")
    .run('2026-07-28T00:00:00.000Z');
  metadataDb.close();
  assert.throws(() => rehearseAuthorityMigration({
    sourceDb: metadataSource,
    copyDb: path.join(root, 'metadata-mismatch-copy.db'),
    authorityId: 'wrong-authority',
    commandReplay: () => [],
  }), /AUTHORITY_MIGRATION_AUTHORITY_MISMATCH/,
  'copy migration must reject a requested authority that differs from the database authority metadata');

  const ambiguous = path.join(root, 'ambiguous.db');
  fs.copyFileSync(source, ambiguous);
  const ambiguousCopy = path.join(root, 'ambiguous-copy.db');
  const ambiguousDb = new Database(ambiguous);
  ambiguousDb.prepare("UPDATE users SET teacher_id=NULL WHERE id='teacher-1'").run();
  ambiguousDb.prepare("UPDATE user_role_grants SET subject_type=NULL,subject_id=NULL WHERE user_id='teacher-1'").run();
  ambiguousDb.close();
  rehearseAuthorityMigration({
    sourceDb: ambiguous,
    copyDb: ambiguousCopy,
    authorityId: 'authority-test',
    commandReplay: () => [],
  });
  const unboundCopyDb = new Database(ambiguousCopy, { readonly: true });
  assert.deepStrictEqual(
    unboundCopyDb.prepare(`SELECT role,subject_type,subject_id FROM authority_role_bindings
      WHERE authority_id='authority-test' AND user_id='teacher-1' AND status='active'`).get(),
    { role: 'teacher', subject_type: null, subject_id: null },
    'a formal role may be migrated before a local business profile is bound',
  );
  unboundCopyDb.close();

  const legacyGrantSource = path.join(root, 'legacy-grant-source.db');
  fs.copyFileSync(source, legacyGrantSource);
  const legacyGrantDb = new Database(legacyGrantSource);
  legacyGrantDb.prepare("INSERT INTO users VALUES ('student-1','visitor',1,1,'approved',0,NULL,'student-record-1')").run();
  legacyGrantDb.prepare(`INSERT INTO user_role_grants
    (user_id,role,subject_type,subject_id,status,source,granted_by,created_at,updated_at,revoked_at)
    VALUES ('student-1','student','student','student-record-1','active','legacy',NULL,?,?,NULL)`)
    .run('2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
  legacyGrantDb.close();
  const legacyGrantCopy = path.join(root, 'legacy-grant-copy.db');
  rehearseAuthorityMigration({
    sourceDb: legacyGrantSource,
    copyDb: legacyGrantCopy,
    authorityId: 'authority-test',
    now: '2026-07-28T00:00:00.000Z',
    commandReplay: () => [],
  });
  const legacyGrantCopyDb = new Database(legacyGrantCopy, { readonly: true });
  assert.deepStrictEqual(
    legacyGrantCopyDb.prepare(`SELECT role,subject_type,subject_id FROM authority_role_bindings
      WHERE authority_id='authority-test' AND user_id='student-1' AND status='active'`).all(),
    [{ role: 'student', subject_type: 'student', subject_id: 'student-record-1' }],
    'an active legacy user_role_grant is migration input only and must be represented by a canonical copy binding',
  );
  legacyGrantCopyDb.close();

  const duplicateSource = path.join(root, 'duplicate-source.db');
  fs.copyFileSync(source, duplicateSource);
  const duplicateDb = new Database(duplicateSource);
  duplicateDb.exec(`CREATE TABLE authority_accounts (
    user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );`);
  duplicateDb.prepare("INSERT INTO authority_accounts VALUES ('teacher-1','authority-test','active',?,?)")
    .run('2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
  for (const bindingId of ['duplicate-1', 'duplicate-2']) {
    duplicateDb.prepare(`INSERT INTO authority_role_bindings VALUES
      (?, 'authority-test', 'teacher-1', 'teacher', 'teacher', 'teacher-record-1', 'active', 1, NULL, ?, ?, NULL)`)
      .run(bindingId, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
  }
  duplicateDb.close();
  const duplicateBefore = fs.readFileSync(duplicateSource);
  const duplicateCopy = path.join(root, 'duplicate-copy.db');
  assert.throws(
    () => rehearseAuthorityMigration({ sourceDb: duplicateSource, copyDb: duplicateCopy, authorityId: 'authority-test', commandReplay: () => [] }),
    error => error.code === 'AUTHORITY_MIGRATION_ROLE_BINDING_DUPLICATE',
    'duplicate active canonical bindings must be rejected before a compatibility rehearsal can pass',
  );
  assert.deepStrictEqual(
    fs.readFileSync(duplicateSource),
    duplicateBefore,
    'the duplicate fixture remains source-only; rehearsal may only reject its disposable copy',
  );

  const replayCopy = path.join(root, 'replay-copy.db');
  assert.throws(
    () => rehearseAuthorityMigration({ sourceDb: source, copyDb: replayCopy, commandReplay: () => ['fixture-replay-mismatch'] }),
    /AUTHORITY_MIGRATION_REHEARSAL_FAILED/,
  );
  assert.deepStrictEqual(fs.readFileSync(source), before, 'a failed command-replay rehearsal must still preserve the source authority database');

  const unpromotedDb = path.join(root, 'unpromoted.db');
  fs.copyFileSync(source, unpromotedDb);
  assert.strictEqual(hasAuthorityCutoverMarker({
    authorityDb: unpromotedDb,
    sourceFingerprint: report.sourceFingerprintBefore,
  }), false, 'an unchanged rehearsal source must never be considered cut over');

  const noSuperCopy = path.join(root, 'no-super-copy.db');
  fs.copyFileSync(copy, noSuperCopy);
  const noSuperDb = new Database(noSuperCopy);
  noSuperDb.prepare("DELETE FROM authority_role_bindings WHERE role='super_admin'").run();
  noSuperDb.prepare("DELETE FROM authority_accounts WHERE user_id='super-1'").run();
  noSuperDb.pragma('wal_checkpoint(TRUNCATE)');
  noSuperDb.close();
  const noSuperSource = path.join(root, 'no-super-source.db');
  fs.copyFileSync(source, noSuperSource);
  assert.throws(() => promoteAuthorityCutover({
    authorityDb: noSuperSource,
    migratedCopyDb: noSuperCopy,
    rollbackDb: path.join(root, 'no-super.rollback.db'),
    report: { ...report, copyFingerprint: require('./authorityMigrationService').fingerprint(noSuperCopy) },
  }), /AUTHORITY_CUTOVER_CANONICAL_SUPER_ADMIN_REQUIRED/,
  'promotion must fail closed when the verified artifact lacks an active canonical super-admin binding');

  const promotedDb = path.join(root, 'promoted.db');
  const rollbackDb = path.join(root, 'promoted.rollback.db');
  fs.copyFileSync(source, promotedDb);
  const promoted = promoteAuthorityCutover({
    authorityDb: promotedDb,
    migratedCopyDb: copy,
    rollbackDb,
    report,
    now: '2026-07-28T00:06:00.000Z',
  });
  assert.strictEqual(promoted.sourceFingerprint, report.sourceFingerprintBefore);
  assert.strictEqual(fs.existsSync(rollbackDb), true, 'atomic cutover must retain the exact pre-cutover authority database');
  assert.strictEqual(hasAuthorityCutoverMarker({
    authorityDb: promotedDb,
    sourceFingerprint: report.sourceFingerprintBefore,
  }), true, 'the promoted migration copy must carry the cutover marker');
  const promotedRead = new Database(promotedDb, { readonly: true });
  assert.strictEqual(promotedRead.prepare(
    "SELECT status FROM authority_role_bindings WHERE authority_id='authority-test' AND user_id='teacher-1' AND role='teacher'"
  ).get().status, 'active', 'the active database must be the verified migrated copy, not the unchanged rehearsal source');
  promotedRead.close();
  assert.deepStrictEqual(fs.readFileSync(rollbackDb), before,
    'the rollback database must preserve the exact pre-cutover bytes');

  const mismatchSource = path.join(root, 'mismatch-source.db');
  const mismatchBackup = path.join(root, 'mismatch.rollback.db');
  fs.copyFileSync(source, mismatchSource);
  const mismatchBefore = fs.readFileSync(mismatchSource);
  assert.throws(() => promoteAuthorityCutover({
    authorityDb: mismatchSource,
    migratedCopyDb: copy,
    rollbackDb: mismatchBackup,
    report: { ...report, copyFingerprint: 'wrong-copy-fingerprint' },
  }), /AUTHORITY_CUTOVER_COPY_FINGERPRINT_MISMATCH/);
  assert.deepStrictEqual(fs.readFileSync(mismatchSource), mismatchBefore,
    'a rejected promotion must not mutate the active authority database');
  assert.strictEqual(fs.existsSync(mismatchBackup), false,
    'a rejected promotion must not create a rollback artifact');

  console.log('authorityMigrationService tests passed');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* Windows may retain a closed SQLite handle briefly. */ }
}
