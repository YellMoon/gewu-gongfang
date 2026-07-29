const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { rehearseAuthorityMigration } = require('../backend/src/services/authorityMigrationService');

function fingerprint(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function activeLegacyRole(user = {}) {
  if (user.deleted || user.status === 0 || user.login_enabled === 0 || user.review_status !== 'approved') return null;
  const role = String(user.role || '').trim();
  return ['teacher', 'student', 'admin', 'super_admin'].includes(role) ? role : null;
}

function applyAuthorityTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authority_accounts (user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS authority_role_bindings (binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL, grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT);
    CREATE TABLE IF NOT EXISTS authority_migration_ledger (name TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL, applied_at TEXT NOT NULL, report_json TEXT NOT NULL);
  `);
}

function legacyRehearse({ sourceDb, copyDb, authorityId = 'default', now = new Date().toISOString() } = {}) {
  const sourcePath = path.resolve(String(sourceDb || ''));
  const copyPath = path.resolve(String(copyDb || ''));
  if (!sourceDb || !copyDb || !fs.existsSync(sourcePath)) throw new Error('REHEARSAL_SOURCE_DB_REQUIRED');
  if (sourcePath === copyPath || fs.existsSync(copyPath)) throw new Error('REHEARSAL_COPY_PATH_INVALID');
  const before = fingerprint(sourcePath);
  fs.mkdirSync(path.dirname(copyPath), { recursive: true });
  fs.copyFileSync(sourcePath, copyPath, fs.constants.COPYFILE_EXCL);
  const db = new Database(copyPath);
  try {
    applyAuthorityTables(db);
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    const seed = db.transaction(() => {
      for (const user of users) {
        const role = activeLegacyRole(user);
        db.prepare(`INSERT OR IGNORE INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
          VALUES(?,?,?, ?,?)`).run(user.id, authorityId, role ? 'active' : 'disabled', now, now);
        if (!role) continue;
        const subjectId = role === 'teacher' ? user.teacher_id : role === 'student' ? user.student_id : null;
        if ((role === 'teacher' || role === 'student') && !subjectId) continue;
        db.prepare(`INSERT OR IGNORE INTO authority_role_bindings
          (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,granted_by,created_at,updated_at,revoked_at)
          VALUES(?,?,?,?,?,?, 'active',1,'compatibility-rehearsal',?,?,NULL)`)
          .run(`legacy:${user.id}:${role}`, authorityId, user.id, role,
            role === 'teacher' ? 'teacher' : role === 'student' ? 'student' : null, subjectId, now, now);
      }
    });
    seed();
    const parityFailures = users.filter(user => {
      const role = activeLegacyRole(user);
      if (!role) return false;
      const binding = db.prepare('SELECT * FROM authority_role_bindings WHERE user_id=? AND role=? AND status=?').get(user.id, role, 'active');
      return !binding || ((role === 'teacher' || role === 'student') && !binding.subject_id);
    }).length;
    const report = { sourceFingerprint: before, copiedFingerprint: fingerprint(copyPath), parityFailures, sourceMutated: fingerprint(sourcePath) !== before };
    db.prepare(`INSERT OR REPLACE INTO authority_migration_ledger(name,source_fingerprint,applied_at,report_json)
      VALUES('runtime-architecture-rehearsal',?,?,?)`).run(before, now, JSON.stringify(report));
    return report;
  } finally {
    db.close();
  }
}

function rehearse(options = {}) {
  const report = rehearseAuthorityMigration(options);
  return {
    ...report,
    sourceFingerprint: report.sourceFingerprintBefore,
    copiedFingerprint: report.copyFingerprint,
    sourceMutated: report.sourceFingerprintBefore !== report.sourceFingerprintAfter,
  };
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-runtime-rehearsal-'));
  try {
    const source = path.join(root, 'source.db');
    const copy = path.join(root, 'copy.db');
    const db = new Database(source);
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY, role TEXT, status INTEGER, login_enabled INTEGER, review_status TEXT, deleted INTEGER, teacher_id TEXT, student_id TEXT);");
    db.prepare("INSERT INTO users VALUES ('self-test-user','teacher',1,1,'approved',0,'self-test-teacher',NULL)").run();
    db.close();
    const report = rehearse({
      sourceDb: source,
      copyDb: copy,
      now: '2026-07-27T00:00:00.000Z',
      commandReplay: ({ db, authorityId }) => (
        db.prepare("SELECT 1 AS ok FROM authority_role_bindings WHERE authority_id=? AND user_id='self-test-user' AND role='teacher' AND status='active'")
          .get(authorityId)
          ? []
          : ['self-test-role-fixture-missing']
      ),
    });
    if (report.sourceMutated || report.parityFailures.length || report.commandReplayFailures.length) throw new Error('REHEARSAL_SELF_TEST_FAILED');
    return report;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) console.log(JSON.stringify(selfTest()));
  else throw new Error('usage: node scripts/runtime-architecture-rehearsal.js --self-test');
}

module.exports = { activeLegacyRole, rehearse, selfTest };
