const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { listCanonicalAuthorityRoleGrants } = require('./authorityRoleGrantAdapter');

function migrationError(code) {
  return Object.assign(new Error(code), { code });
}

function fingerprint(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function activeAuthorityAccount(user = {}) {
  return !user.deleted
    && user.status !== 0
    && user.login_enabled !== 0
    && user.review_status === 'approved';
}

function ensureMigrationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authority_accounts (user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS authority_role_bindings (binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL, grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT);
    CREATE TABLE IF NOT EXISTS authority_migration_ledger (name TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL, applied_at TEXT NOT NULL, report_json TEXT NOT NULL);
  `);
}

function ensureCanonicalBindingUniqueness(db) {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_authority_role_bindings_active
    ON authority_role_bindings(authority_id,user_id,role) WHERE status='active';`);
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function roleSubject(role, source = {}) {
  const subjectId = role === 'teacher' ? source.teacher_id || source.subject_id
    : role === 'student' ? source.student_id || source.subject_id : null;
  const scopedRole = role === 'teacher' || role === 'student';
  const hasSubjectId = Boolean(String(subjectId || '').trim());
  const subjectType = scopedRole && hasSubjectId ? role : null;
  if (scopedRole && !hasSubjectId && source.subject_type) {
    throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
  }
  if (source.subject_type && source.subject_type !== subjectType) {
    throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
  }
  return { subjectType, subjectId: subjectId || null };
}

function legacyRoleInputs(db, user) {
  const inputs = new Map();
  function add(role, source) {
    if (!['teacher', 'student', 'super_admin'].includes(role)) return;
    const next = roleSubject(role, source);
    const existing = inputs.get(role);
    if (existing && (existing.subjectType !== next.subjectType || existing.subjectId !== next.subjectId)) {
      throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
    }
    inputs.set(role, next);
  }
  if (tableExists(db, 'user_role_grants')) {
    const grants = db.prepare(`SELECT * FROM user_role_grants
      WHERE user_id=? AND status='active' ORDER BY role`).all(user.id);
    for (const grant of grants) add(String(grant.role || '').trim(), grant);
  }
  return [...inputs.entries()].map(([role, subject]) => ({ role, ...subject }));
}

function assertCanonicalBindingsUnambiguous(db, authorityId) {
  const users = db.prepare(`SELECT DISTINCT user_id FROM authority_role_bindings
    WHERE authority_id=? AND status='active' ORDER BY user_id`).all(authorityId);
  for (const row of users) {
    try {
      listCanonicalAuthorityRoleGrants(db, { authorityId, userId: row.user_id });
    } catch (error) {
      if (error.code === 'AUTHORITY_ROLE_BINDING_DUPLICATE') throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_DUPLICATE');
      if (error.code === 'AUTHORITY_ROLE_BINDING_AMBIGUOUS') throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
      throw error;
    }
  }
}

function assertCopyOnly(sourcePath, copyPath) {
  if (!sourcePath || !copyPath || !fs.existsSync(sourcePath) || path.resolve(sourcePath) === path.resolve(copyPath) || fs.existsSync(copyPath)) {
    throw migrationError('AUTHORITY_MIGRATION_COPY_PATH_INVALID');
  }
}

function resolveMigrationAuthority(db, requestedAuthorityId) {
  const requested = String(requestedAuthorityId || '').trim();
  const metadata = tableExists(db, 'authority_metadata')
    ? String(db.prepare("SELECT value FROM authority_metadata WHERE key='database_authority_id'").get()?.value || '').trim()
    : '';
  if (metadata && requested && metadata !== requested) {
    throw migrationError('AUTHORITY_MIGRATION_AUTHORITY_MISMATCH');
  }
  return metadata || requested || 'default';
}

function rehearseAuthorityMigration({ sourceDb, copyDb, authorityId: requestedAuthorityId, now = new Date().toISOString(), commandReplay } = {}) {
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
  let report;
  try {
    ensureMigrationSchema(db);
    const authorityId = resolveMigrationAuthority(db, requestedAuthorityId);
    assertCanonicalBindingsUnambiguous(db, authorityId);
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();
    const parityFailures = [];
    const seed = db.transaction(() => {
      for (const user of users) {
        const desiredRoles = legacyRoleInputs(db, user);
        db.prepare('INSERT OR IGNORE INTO authority_accounts(user_id,authority_id,status,created_at,updated_at) VALUES(?,?,?,?,?)')
          .run(user.id, authorityId, activeAuthorityAccount(user) ? 'active' : 'disabled', now, now);
        for (const desired of desiredRoles) {
          const existing = db.prepare('SELECT * FROM authority_role_bindings WHERE authority_id=? AND user_id=? AND role=? AND status=?').all(authorityId, user.id, desired.role, 'active');
          if (existing.length > 1) {
            throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_DUPLICATE');
          }
          if (existing.length === 1
            && ((existing[0].subject_type || null) !== desired.subjectType || (existing[0].subject_id || null) !== desired.subjectId)) {
            throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
          }
          if (!existing.length) db.prepare(`INSERT INTO authority_role_bindings
            (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,granted_by,created_at,updated_at,revoked_at)
            VALUES(?,?,?,?,? ,?,'active',1,'copy-only-rehearsal',?,?,NULL)`)
            .run(`legacy:${user.id}:${desired.role}`, authorityId, user.id, desired.role, desired.subjectType, desired.subjectId, now, now);
        }
      }
    });
    seed();
    for (const user of users) {
      const desiredRoles = legacyRoleInputs(db, user);
      if (!desiredRoles.length) continue;
      let canonical;
      try {
        canonical = listCanonicalAuthorityRoleGrants(db, { authorityId, userId: user.id });
      } catch (error) {
        if (error.code === 'AUTHORITY_ROLE_BINDING_DUPLICATE') throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_DUPLICATE');
        if (error.code === 'AUTHORITY_ROLE_BINDING_AMBIGUOUS') throw migrationError('AUTHORITY_MIGRATION_ROLE_BINDING_AMBIGUOUS');
        throw error;
      }
      for (const desired of desiredRoles) {
        const binding = canonical.find(candidate => candidate.role === desired.role);
        if (!binding || binding.subjectType !== desired.subjectType || binding.subjectId !== desired.subjectId) {
          parityFailures.push({ userId: user.id, role: desired.role, code: 'AUTHORITY_MIGRATION_SCOPE_PARITY_FAILED' });
        }
      }
    }
    ensureCanonicalBindingUniqueness(db);
    const replayResult = commandReplay({ db, authorityId });
    const commandReplayFailures = Array.isArray(replayResult) ? replayResult : ['AUTHORITY_MIGRATION_COMMAND_REPLAY_INVALID'];
    const sourceFingerprintAfter = fingerprint(sourcePath);
    report = {
      authorityId, sourceFingerprintBefore, sourceFingerprintAfter,
      parityFailures, commandReplayFailures,
      legacyRoutesSafeToRemove: sourceFingerprintBefore === sourceFingerprintAfter && parityFailures.length === 0 && commandReplayFailures.length === 0,
    };
    if (!report.legacyRoutesSafeToRemove) throw migrationError('AUTHORITY_MIGRATION_REHEARSAL_FAILED');
    db.prepare('INSERT INTO authority_migration_ledger(name,source_fingerprint,applied_at,report_json) VALUES(?,?,?,?)')
      .run('authority_protocol_v1_rehearsal', sourceFingerprintBefore, now, JSON.stringify(report));
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
  report.copyFingerprint = fingerprint(copyPath);
  return report;
}

function assertCutoverArtifactReady(db, authorityId) {
  const authority = String(authorityId || '').trim();
  if (!authority) throw migrationError('AUTHORITY_CUTOVER_AUTHORITY_REQUIRED');
  const metadata = tableExists(db, 'authority_metadata')
    ? String(db.prepare("SELECT value FROM authority_metadata WHERE key='database_authority_id'").get()?.value || '').trim()
    : '';
  if (metadata && metadata !== authority) throw migrationError('AUTHORITY_CUTOVER_AUTHORITY_MISMATCH');
  const superAdmin = db.prepare(`SELECT b.binding_id FROM authority_role_bindings b
    INNER JOIN authority_accounts a ON a.user_id=b.user_id AND a.authority_id=b.authority_id
    WHERE b.authority_id=? AND b.role='super_admin' AND b.status='active'
      AND b.subject_type IS NULL AND b.subject_id IS NULL AND a.status='active' LIMIT 1`).get(authority);
  if (!superAdmin) throw migrationError('AUTHORITY_CUTOVER_CANONICAL_SUPER_ADMIN_REQUIRED');
  const orphan = db.prepare(`SELECT b.binding_id FROM authority_role_bindings b
    LEFT JOIN authority_accounts a ON a.user_id=b.user_id AND a.authority_id=b.authority_id AND a.status='active'
    WHERE b.status='active' AND a.user_id IS NULL LIMIT 1`).get();
  if (orphan) throw migrationError('AUTHORITY_CUTOVER_ORPHAN_BINDING');
}

function promoteAuthorityCutover({
  authorityDb,
  migratedCopyDb,
  rollbackDb,
  report,
  now = new Date().toISOString(),
} = {}) {
  if (!report?.legacyRoutesSafeToRemove || !report.sourceFingerprintBefore
    || report.sourceFingerprintBefore !== report.sourceFingerprintAfter
    || !report.copyFingerprint
    || (report.parityFailures || []).length || (report.commandReplayFailures || []).length) {
    throw migrationError('AUTHORITY_CUTOVER_REHEARSAL_REQUIRED');
  }
  const target = path.resolve(String(authorityDb || ''));
  const migratedCopy = path.resolve(String(migratedCopyDb || ''));
  const rollback = path.resolve(String(rollbackDb || ''));
  const staged = `${target}.cutover-next`;
  if (!target || !migratedCopy || !rollback
    || target === migratedCopy || target === rollback || migratedCopy === rollback) {
    throw migrationError('AUTHORITY_CUTOVER_PATHS_INVALID');
  }
  if (!fs.existsSync(target) || fingerprint(target) !== report.sourceFingerprintBefore) {
    throw migrationError('AUTHORITY_CUTOVER_SOURCE_FINGERPRINT_MISMATCH');
  }
  if (!fs.existsSync(migratedCopy) || fingerprint(migratedCopy) !== report.copyFingerprint) {
    throw migrationError('AUTHORITY_CUTOVER_COPY_FINGERPRINT_MISMATCH');
  }
  if (fs.existsSync(rollback) || fs.existsSync(staged)) {
    throw migrationError('AUTHORITY_CUTOVER_TARGET_EXISTS');
  }
  for (const sidecar of [`${target}-wal`, `${target}-shm`, `${migratedCopy}-wal`, `${migratedCopy}-shm`]) {
    if (fs.existsSync(sidecar)) throw migrationError('AUTHORITY_CUTOVER_DATABASE_NOT_QUIESCENT');
  }

  try {
    fs.copyFileSync(migratedCopy, staged, fs.constants.COPYFILE_EXCL);
    const stagedDb = new Database(staged);
    try {
      ensureMigrationSchema(stagedDb);
      assertCutoverArtifactReady(stagedDb, report.authorityId);
      stagedDb.prepare(`INSERT INTO authority_migration_ledger
        (name,source_fingerprint,applied_at,report_json) VALUES(?,?,?,?)`)
        .run('authority_protocol_v1_cutover', report.sourceFingerprintBefore, now, JSON.stringify(report));
    } finally {
      stagedDb.close();
    }
    if (fingerprint(target) !== report.sourceFingerprintBefore) {
      throw migrationError('AUTHORITY_CUTOVER_SOURCE_FINGERPRINT_MISMATCH');
    }
    const activeFingerprint = fingerprint(staged);
    fs.copyFileSync(target, rollback, fs.constants.COPYFILE_EXCL);
    if (fingerprint(rollback) !== report.sourceFingerprintBefore) {
      throw migrationError('AUTHORITY_CUTOVER_ROLLBACK_FINGERPRINT_MISMATCH');
    }
    fs.renameSync(staged, target);
    return Object.freeze({
      authorityDb: target,
      rollbackDb: rollback,
      sourceFingerprint: report.sourceFingerprintBefore,
      activeFingerprint,
    });
  } catch (error) {
    if (fs.existsSync(staged)) fs.rmSync(staged, { force: true });
    throw error;
  }
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

module.exports = {
  fingerprint,
  rehearseAuthorityMigration,
  promoteAuthorityCutover,
  hasAuthorityCutoverMarker,
};
