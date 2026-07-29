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
db.close();

const report = rehearse({
  sourceDb: source,
  copyDb: copy,
  now: '2026-07-27T00:00:00.000Z',
  commandReplay: ({ db: copyDb, authorityId }) => (
    copyDb.prepare("SELECT 1 AS ok FROM authority_role_bindings WHERE authority_id=? AND user_id='u1' AND role='teacher' AND status='active'")
      .get(authorityId)
      ? []
      : ['replay-fixture-missing']
  ),
});
assert.equal(report.sourceMutated, false);
assert.deepEqual(report.parityFailures, []);
assert.deepEqual(report.commandReplayFailures, []);
assert.equal(fs.existsSync(copy), true);
const sourceCheck = new Database(source, { readonly: true });
assert.equal(sourceCheck.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
sourceCheck.close();
fs.rmSync(root, { recursive: true, force: true });
console.log('runtime architecture rehearsal tests passed');
