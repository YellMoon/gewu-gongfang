const ROLE_SET = new Set(['visitor', 'student', 'teacher', 'super_admin']);

function authorityError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizedRole(value) {
  const role = String(value || 'visitor').trim();
  if (!ROLE_SET.has(role)) throw authorityError('ACTING_ROLE_INVALID');
  return role;
}

function normalizedGrant(grant) {
  if (!grant || typeof grant !== 'object') return null;
  const role = String(grant.role || '').trim();
  const status = String(grant.status || '').trim();
  const authorityId = String(grant.authorityId || grant.authority_id || '').trim();
  const bindingId = String(grant.bindingId || grant.binding_id || grant.subjectId || grant.subject_id || '').trim();
  if (!ROLE_SET.has(role) || role === 'visitor' || status !== 'active' || !authorityId) return null;
  return { role, status, authorityId, bindingId, grantVersion: Number(grant.grantVersion || grant.grant_version || 1) };
}

function resolveActingScope({ userId, actingRole = 'visitor', authorityId = '', grants = [] } = {}) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) throw authorityError('ACTOR_USER_ID_REQUIRED');
  const role = normalizedRole(actingRole);
  if (role === 'visitor') return { kind: 'visitor', userId: normalizedUserId };
  const candidates = Array.isArray(grants) ? grants.map(normalizedGrant).filter(Boolean) : [];
  const requestedAuthorityId = String(authorityId || '').trim();
  const grant = candidates.find(candidate => candidate.role === role
    && (!requestedAuthorityId || candidate.authorityId === requestedAuthorityId));
  if (!grant) throw authorityError('ACTING_ROLE_NOT_GRANTED');
  if (role === 'student') {
    return { kind: 'student', userId: normalizedUserId, studentId: grant.bindingId || null, authorityId: grant.authorityId };
  }
  if (role === 'teacher') {
    return { kind: 'teacher', userId: normalizedUserId, teacherId: grant.bindingId || null, authorityId: grant.authorityId };
  }
  return { kind: role, userId: normalizedUserId, authorityId: grant.authorityId };
}

module.exports = { authorityError, normalizedGrant, resolveActingScope };
