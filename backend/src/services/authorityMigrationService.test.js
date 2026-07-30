const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { rehearseAuthorityMigration, writeAuthorityCutoverMarker, hasAuthorityCutoverMarker } = require('./authorityMigrationService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-migration-service-'));
try {
  const source = path.join(root, 'source.db');
  const copy = path.join(root, 'copy.db');
  const db = new Database(source);
  db.exec(`CREATE TABLE users(
    id TEXT PRIMARY KEY, role TEXT, status INTEGER, login_enabled INTEGER,
    review_status TEXT, deleted INTEGER, teacher_id TEXT, student_id TEXT
  );`);
  db.prepare("INSERT INTO users VALUES ('teacher-1','teacher',1,1,'approved',0,'teacher-record-1',NULL)").run();
  db.prepare("INSERT INTO users VALUES ('admin-1','admin',1,1,'approved',0,NULL,NULL)").run();
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
  assert.strictEqual(copyDb.prepare("SELECT name FROM authority_migration_ledger WHERE name='authority_protocol_v1_rehearsal'").get().name, 'authority_protocol_v1_rehearsal');
  copyDb.close();

  const ambiguous = path.join(root, 'ambiguous.db');
  fs.copyFileSync(source, ambiguous);
  const ambiguousCopy = path.join(root, 'ambiguous-copy.db');
  const ambiguousDb = new Database(ambiguous);
  ambiguousDb.prepare("UPDATE users SET teacher_id=NULL WHERE id='teacher-1'").run();
  ambiguousDb.close();
  assert.throws(
    () => rehearseAuthorityMigration({ sourceDb: ambiguous, copyDb: ambiguousCopy, commandReplay: () => [] }),
    /AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS/,
  );

  const legacyGrantSource = path.join(root, 'legacy-grant-source.db');
  fs.copyFileSync(source, legacyGrantSource);
  const legacyGrantDb = new Database(legacyGrantSource);
  legacyGrantDb.exec(`CREATE TABLE user_role_grants (
    user_id TEXT NOT NULL, role TEXT NOT NULL, subject_type TEXT, subject_id TEXT,
    status TEXT NOT NULL, source TEXT, granted_by TEXT, created_at TEXT, updated_at TEXT, revoked_at TEXT
  );`);
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

  const markerDb = path.join(root, 'marker.db');
  fs.copyFileSync(source, markerDb);
  assert.throws(() => writeAuthorityCutoverMarker({ authorityDb: markerDb, report: { legacyRoutesSafeToRemove: false } }), /AUTHORITY_CUTOVER_REHEARSAL_REQUIRED/);
  writeAuthorityCutoverMarker({ authorityDb: markerDb, report, now: '2026-07-28T00:05:00.000Z' });
  assert.strictEqual(hasAuthorityCutoverMarker({ authorityDb: markerDb, sourceFingerprint: report.sourceFingerprintBefore }), true);
  assert.strictEqual(hasAuthorityCutoverMarker({ authorityDb: markerDb, sourceFingerprint: 'wrong-fingerprint' }), false);

  console.log('authorityMigrationService tests passed');
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* Windows may retain a closed SQLite handle briefly. */ }
}
