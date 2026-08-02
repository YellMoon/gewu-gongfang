const FORMAL_ROLE_ORDER = Object.freeze(['teacher', 'student', 'admin', 'super_admin']);
const FORMAL_ROLE_SET = new Set(FORMAL_ROLE_ORDER);

function authorityRoleError(code) {
  return Object.assign(new Error(code), { code });
}

function requiredText(value, code) {
  const normalized = String(value || '').trim();
  if (!normalized) throw authorityRoleError(code);
  return normalized;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function assertAuthorityRoleTables(db) {
  if (!db || typeof db.prepare !== 'function') throw authorityRoleError('AUTHORITY_ROLE_DATABASE_REQUIRED');
  if (!tableExists(db, 'authority_accounts') || !tableExists(db, 'authority_role_bindings')) {
    throw authorityRoleError('AUTHORITY_ROLE_TABLES_REQUIRED');
  }
}

function mapGrant(row) {
  return Object.freeze({
    bindingId: row.binding_id,
    authorityId: row.authority_id,
    userId: row.user_id,
    role: row.role,
    subjectType: row.subject_type || null,
    subjectId: row.subject_id || null,
    status: row.status,
    grantVersion: Number(row.grant_version),
    grantedBy: row.granted_by || null,
  });
}

function assertCanonicalGrantRows(rows) {
  const seenRoles = new Set();
  for (const grant of rows) {
    if (seenRoles.has(grant.role)) throw authorityRoleError('AUTHORITY_ROLE_BINDING_DUPLICATE');
    seenRoles.add(grant.role);
    const hasSubjectType = Boolean(grant.subjectType);
    const hasSubjectId = Boolean(grant.subjectId);
    if ((grant.role === 'teacher' || grant.role === 'student')
      && ((hasSubjectType !== hasSubjectId) || (hasSubjectType && grant.subjectType !== grant.role))) {
      throw authorityRoleError('AUTHORITY_ROLE_BINDING_AMBIGUOUS');
    }
    if ((grant.role === 'admin' || grant.role === 'super_admin') && (hasSubjectType || hasSubjectId)) {
      throw authorityRoleError('AUTHORITY_ROLE_BINDING_AMBIGUOUS');
    }
  }
}

function listCanonicalAuthorityRoleGrants(db, { authorityId, userId } = {}) {
  assertAuthorityRoleTables(db);
  const authority = requiredText(authorityId, 'AUTHORITY_ROLE_AUTHORITY_REQUIRED');
  const user = requiredText(userId, 'AUTHORITY_ROLE_USER_REQUIRED');
  const rows = db.prepare(`SELECT * FROM authority_role_bindings
    WHERE authority_id=? AND user_id=? AND status='active'
    ORDER BY CASE role
      WHEN 'teacher' THEN 1
      WHEN 'student' THEN 2
      WHEN 'admin' THEN 3
      WHEN 'super_admin' THEN 4
      ELSE 99 END, binding_id`).all(authority, user);
  const grants = rows
    .map(mapGrant)
    .filter(grant => FORMAL_ROLE_SET.has(grant.role));
  assertCanonicalGrantRows(grants);
  return Object.freeze(grants);
}

function resolveCanonicalAuthorityRoleContext(db, { authorityId, userId } = {}) {
  assertAuthorityRoleTables(db);
  const authority = requiredText(authorityId, 'AUTHORITY_ROLE_AUTHORITY_REQUIRED');
  const user = requiredText(userId, 'AUTHORITY_ROLE_USER_REQUIRED');
  const account = db.prepare(`SELECT status FROM authority_accounts
    WHERE authority_id=? AND user_id=?`).get(authority, user);
  const grants = listCanonicalAuthorityRoleGrants(db, { authorityId: authority, userId: user });
  const roles = grants.length ? grants.map(grant => grant.role) : ['visitor'];
  return Object.freeze({
    authorityId: authority,
    userId: user,
    accountStatus: account?.status || 'missing',
    roles: Object.freeze(roles),
    grants,
  });
}

function resolveActiveAuthorityRoleContext(db, { userId } = {}) {
  assertAuthorityRoleTables(db);
  const user = requiredText(userId, 'AUTHORITY_ROLE_USER_REQUIRED');
  const account = db.prepare(`SELECT authority_id,status FROM authority_accounts
    WHERE user_id=?`).get(user);
  if (!account || account.status !== 'active') {
    throw authorityRoleError('AUTHORITY_ACCOUNT_NOT_ACTIVE');
  }
  return resolveCanonicalAuthorityRoleContext(db, {
    authorityId: account.authority_id,
    userId: user,
  });
}

module.exports = {
  FORMAL_ROLE_ORDER,
  authorityRoleError,
  assertCanonicalGrantRows,
  listCanonicalAuthorityRoleGrants,
  resolveActiveAuthorityRoleContext,
  resolveCanonicalAuthorityRoleContext,
};
