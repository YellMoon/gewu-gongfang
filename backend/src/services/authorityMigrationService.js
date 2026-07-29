const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function migrationError(code) {
  return Object.assign(new Error(code), { code });
}

function fingerprint(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function activeLegacyRole(user = {}) {
  if (user.deleted || user.status === 0 || user.login_enabled === 0 || user.review_status !== 'approved') return null;
  const role = String(user.role || '').trim();
  return ['teacher', 'student', 'admin', 'super_admin'].includes(role) ? role : null;
}

function ensureMigrationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authority_accounts (user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS authority_role_bindings (binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL, grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_authority_role_bindings_active ON authority_role_bindings(authority_id,user_id,role) WHERE status='active';
    CREATE TABLE IF NOT EXISTS authority_migration_ledger (name TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL, applied_at TEXT NOT NULL, report_json TEXT NOT NULL);
  `);
}

function assertCopyOnly(sourcePath, copyPath) {
  if (!sourcePath || !copyPath || !fs.existsSync(sourcePath) || path.resolve(sourcePath) === path.resolve(copyPath) || fs.existsSync(copyPath)) {
    throw migrationError('AUTHORITY_MIGRATION_COPY_PATH_INVALID');
  }
}

function rehearseAuthorityMigration({ sourceDb, copyDb, authorityId = 'default', now = new Date().toISOString(), commandReplay } = {}) {
  const sourcePath = path.resolve(String(sourceDb || ''));
  const copyPath = path.resolve(String(copyDb || ''));
  assertCopyOnly(sourcePath, copyPath);
  if (typeof commandReplay !== 'function') {
    throw migrationError('AUTHORITY_MIGRATION_COMMAND_REPLAY_REQUIRED');
  }
  const sourceFingerprintBefore = fingerprint(sourcePath);
  fs.mkdirSync(path.dirname(copyPath), { recursive: true });
  fs.copyFileSync(sourcePath, copyPath, fs.constants.COPYFILE_EXCL);
  const db = new Database(copyPath);
  try {
    ensureMigrationSchema(db);
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    const parityFailures = [];
    const seed = db.transaction(() => {
      for (const user of users) {
        const role = activeLegacyRole(user);
        db.prepare('INSERT OR IGNORE INTO authority_accounts(user_id,authority_id,status,created_at,updated_at) VALUES(?,?,?,?,?)')
          .run(user.id, authorityId, role ? 'active' : 'disabled', now, now);
        if (!role) continue;
        const subjectId = role === 'teacher' ? user.teacher_id : role === 'student' ? user.student_id : null;
        if ((role === 'teacher' || role === 'student') && !subjectId) {
          throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
        }
        const existing = db.prepare('SELECT * FROM authority_role_bindings WHERE authority_id=? AND user_id=? AND role=? AND status=?').all(authorityId, user.id, role, 'active');
        if (existing.length > 1 || (existing.length === 1 && (existing[0].subject_id || null) !== (subjectId || null))) {
          throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
        }
        if (!existing.length) db.prepare(`INSERT INTO authority_role_bindings
          (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,granted_by,created_at,updated_at,revoked_at)
          VALUES(?,?,?,?,? ,?,'active',1,'copy-only-rehearsal',?,?,NULL)`)
          .run(`legacy:${user.id}:${role}`, authorityId, user.id, role, role === 'teacher' || role === 'student' ? role : null, subjectId || null, now, now);
      }
    });
    seed();
    for (const user of users) {
      const role = activeLegacyRole(user);
      if (!role) continue;
      const binding = db.prepare('SELECT * FROM authority_role_bindings WHERE authority_id=? AND user_id=? AND role=? AND status=?').get(authorityId, user.id, role, 'active');
      const expectedSubject = role === 'teacher' ? user.teacher_id : role === 'student' ? user.student_id : null;
      if (!binding || (binding.subject_id || null) !== (expectedSubject || null)) parityFailures.push({ userId: user.id, role, code: 'AUTHORITY_MIGRATION_SCOPE_PARITY_FAILED' });
    }
    const replayResult = commandReplay({ db, authorityId });
    const commandReplayFailures = Array.isArray(replayResult) ? replayResult : ['AUTHORITY_MIGRATION_COMMAND_REPLAY_INVALID'];
    const sourceFingerprintAfter = fingerprint(sourcePath);
    const report = {
      sourceFingerprintBefore, sourceFingerprintAfter, copyFingerprint: fingerprint(copyPath),
      parityFailures, commandReplayFailures,
      legacyRoutesSafeToRemove: sourceFingerprintBefore === sourceFingerprintAfter && parityFailures.length === 0 && commandReplayFailures.length === 0,
    };
    if (!report.legacyRoutesSafeToRemove) throw migrationError('AUTHORITY_MIGRATION_REHEARSAL_FAILED');
    db.prepare('INSERT INTO authority_migration_ledger(name,source_fingerprint,applied_at,report_json) VALUES(?,?,?,?)')
      .run('authority_protocol_v1_rehearsal', sourceFingerprintBefore, now, JSON.stringify(report));
    return report;
  } finally { db.close(); }
}

function writeAuthorityCutoverMarker({ authorityDb, report, now = new Date().toISOString() } = {}) {
  if (!report?.legacyRoutesSafeToRemove || !report.sourceFingerprintBefore
    || report.sourceFingerprintBefore !== report.sourceFingerprintAfter
    || (report.parityFailures || []).length || (report.commandReplayFailures || []).length) {
    throw migrationError('AUTHORITY_CUTOVER_REHEARSAL_REQUIRED');
  }
  const target = path.resolve(String(authorityDb || ''));
  if (!fs.existsSync(target) || fingerprint(target) !== report.sourceFingerprintBefore) {
    throw migrationError('AUTHORITY_CUTOVER_SOURCE_FINGERPRINT_MISMATCH');
  }
  const db = new Database(target);
  try {
    ensureMigrationSchema(db);
    db.prepare('INSERT INTO authority_migration_ledger(name,source_fingerprint,applied_at,report_json) VALUES(?,?,?,?)')
      .run('authority_protocol_v1_cutover', report.sourceFingerprintBefore, now, JSON.stringify(report));
  } finally { db.close(); }
}

function hasAuthorityCutoverMarker({ authorityDb, sourceFingerprint } = {}) {
  const target = path.resolve(String(authorityDb || ''));
  if (!fs.existsSync(target) || !sourceFingerprint) return false;
  const db = new Database(target, { readonly: true });
  try {
    const exists = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='authority_migration_ledger'").get();
    if (!exists) return false;
    return Boolean(db.prepare("SELECT 1 AS ok FROM authority_migration_ledger WHERE name='authority_protocol_v1_cutover' AND source_fingerprint=?").get(sourceFingerprint));
  } finally { db.close(); }
}

module.exports = { activeLegacyRole, fingerprint, rehearseAuthorityMigration, writeAuthorityCutoverMarker, hasAuthorityCutoverMarker };
