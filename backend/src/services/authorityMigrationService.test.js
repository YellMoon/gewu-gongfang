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
  fs.rmSync(root, { recursive: true, force: true });
}
