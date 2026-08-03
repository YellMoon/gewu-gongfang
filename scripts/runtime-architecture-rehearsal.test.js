const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { rehearse } = require('./runtime-architecture-rehearsal');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-rehearsal-'));
const source = path.join(root, 'source.db');
const copy = path.join(root, 'copy.db');
const db = new Database(source);
db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, role TEXT, status INTEGER, login_enabled INTEGER, review_status TEXT, deleted INTEGER, teacher_id TEXT, student_id TEXT);
  CREATE TABLE user_role_grants(user_id TEXT, role TEXT, subject_type TEXT, subject_id TEXT, status TEXT, source TEXT, granted_by TEXT, created_at TEXT, updated_at TEXT, revoked_at TEXT);`);
db.prepare("INSERT INTO users VALUES ('u1','teacher',1,1,'approved',0,'t1',NULL)").run();
db.prepare("INSERT INTO users VALUES ('u2','student',1,1,'approved',0,NULL,'s1')").run();
db.prepare("INSERT INTO users VALUES ('u3','visitor',1,1,'approved',0,NULL,NULL)").run();
const insertGrant = db.prepare(`INSERT INTO user_role_grants
  (user_id,role,subject_type,subject_id,status,source,granted_by,created_at,updated_at,revoked_at)
  VALUES (?,?,?,?,'active','runtime-rehearsal-test',NULL,?,?,NULL)`);
insertGrant.run('u1', 'teacher', 'teacher', 't1', '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z');
insertGrant.run('u2', 'student', 'student', 's1', '2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.000Z');
db.close();

const report = rehearse({
  sourceDb: source,
  copyDb: copy,
  now: '2026-07-27T00:00:00.000Z',
  commandReplay: ({ db: copyDb, authorityId }) => {
    const failures = [];
    const scopedBinding = copyDb.prepare(`SELECT 1 AS ok FROM authority_role_bindings
      WHERE authority_id=? AND user_id=? AND role=? AND subject_type=? AND subject_id=? AND status='active'`);
    if (!scopedBinding.get(authorityId, 'u1', 'teacher', 'teacher', 't1')) failures.push('teacher-replay-fixture-missing');
    if (!scopedBinding.get(authorityId, 'u2', 'student', 'student', 's1')) failures.push('student-replay-fixture-missing');
    if (copyDb.prepare("SELECT COUNT(*) AS count FROM authority_role_bindings WHERE authority_id=? AND user_id='u3' AND status='active'").get(authorityId).count !== 0) {
      failures.push('visitor-replay-fixture-unexpected-role');
    }
    return failures;
  },
});
assert.equal(report.sourceMutated, false);
assert.deepEqual(report.parityFailures, []);
assert.deepEqual(report.commandReplayFailures, []);
assert.equal(fs.existsSync(copy), true);
const sourceCheck = new Database(source, { readonly: true });
assert.equal(sourceCheck.prepare('SELECT COUNT(*) AS count FROM users').get().count, 3);
assert.equal(sourceCheck.prepare("SELECT COUNT(*) AS count FROM user_role_grants WHERE status='active'").get().count, 2);
sourceCheck.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('runtime architecture rehearsal tests passed');
