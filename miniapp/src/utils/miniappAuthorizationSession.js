const {
  hasLegacyReviewMarker,
} = require('./accountExperience');
const { permissionIdentityKey } = require('./miniappAuthorizationRuntime');

function roleOf(identity) {
  return identity && (identity.role || identity.user_type) || 'pending';
}

const NORMAL_SCOPE_ALIASES = [
  'role', 'user_type', 'tenant_id', 'tenantId', 'teacher_id', 'teacherId',
  'student_id', 'studentId', 'linked_student_id', 'linkedStudentId',
  'linked_student_ids', 'linkedStudentIds', 'review_status', 'reviewStatus',
  'status', 'active', 'login_enabled', 'loginEnabled', 'deleted', 'disabled',
];

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function firstDefined(identity, ...keys) {
  for (const key of keys) if (hasOwn(identity, key)) return identity[key];
  return undefined;
}

function normalizedIds(...values) {
  const ids = [];
  function append(value) {
    if (Array.isArray(value)) return value.forEach(append);
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.forEach(append);
      } catch (_error) { /* retain the scalar below */ }
    }
    if (value !== undefined && value !== null && String(value).trim()) ids.push(String(value).trim());
  }
  values.forEach(append);
  return Array.from(new Set(ids)).sort();
}

function flagIsTrue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function flagIsFalse(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

function fingerprint(identity) {
  return permissionIdentityKey(identity);
}

function isActive(identity) {
  const reviewStatus = firstDefined(identity, 'review_status', 'reviewStatus');
  const loginEnabled = firstDefined(identity, 'login_enabled', 'loginEnabled');
  const explicitActive = firstDefined(identity, 'active');
  const active = Boolean(identity && identity.id && reviewStatus === 'approved'
    && flagIsTrue(identity.status)
    && flagIsTrue(loginEnabled)
    && !flagIsFalse(explicitActive)
    && !flagIsTrue(identity.deleted)
    && !flagIsTrue(identity.disabled)
    && roleOf(identity) !== 'pending');
  if (!active) return false;
  return !hasLegacyReviewMarker(identity);
}

function normalizedUser(identity, localUser) {
  const local = { ...(localUser || {}) };
  const remote = { ...(identity || {}) };
  for (const key of NORMAL_SCOPE_ALIASES) {
    delete local[key];
    delete remote[key];
  }
  const user = { ...local, ...remote, user_type: roleOf(identity), role: roleOf(identity) };
  const canonicalFields = [
    ['tenant_id', ['tenant_id', 'tenantId']],
    ['teacher_id', ['teacher_id', 'teacherId']],
    ['student_id', ['student_id', 'studentId']],
    ['review_status', ['review_status', 'reviewStatus']],
    ['status', ['status']],
    ['active', ['active']],
    ['login_enabled', ['login_enabled', 'loginEnabled']],
    ['deleted', ['deleted']],
    ['disabled', ['disabled']],
  ];
  for (const [canonical, aliases] of canonicalFields) {
    if (aliases.some(alias => hasOwn(identity, alias))) user[canonical] = firstDefined(identity, ...aliases);
  }
  const studentAliases = ['student_id', 'studentId', 'linked_student_id', 'linkedStudentId', 'linked_student_ids', 'linkedStudentIds'];
  if (studentAliases.some(alias => hasOwn(identity, alias))) {
    user.linked_student_ids = normalizedIds(...studentAliases.map(alias => identity[alias]));
  }
  return user;
}

function createAuthorizationSession(dependencies) {
  let fetchCount = 0;
  let generation = 0;
  async function refresh(localUser, _options = {}) {
    fetchCount += 1;
    const requestId = ++generation;
    const cached = dependencies.readCache() || null;
    try {
      const remote = await dependencies.fetchRemote();
      if (requestId !== generation) return { status: 'stale', identity: null, capabilities: [] };
      const remoteIdentity = remote && remote.identity;
      const rawCapabilities = remote && Array.isArray(remote.capabilities) ? remote.capabilities.filter(value => typeof value === 'string') : [];
      const capabilities = typeof dependencies.sanitizeCapabilities === 'function'
        ? dependencies.sanitizeCapabilities(remoteIdentity, rawCapabilities) : rawCapabilities;
      const active = isActive(remoteIdentity);
      const changed = fingerprint(remoteIdentity) !== fingerprint(localUser);
      const lostCapabilities = Boolean(cached && Array.isArray(cached.capabilities)
        && cached.capabilities.some(capability => !capabilities.includes(capability)));
      if (changed || lostCapabilities || !active) {
        dependencies.clearBusinessCache();
        dependencies.clearPermissionCache();
      }
      const user = normalizedUser(remoteIdentity || { id: localUser && localUser.id, role: 'pending', review_status: 'pending', status: 0, login_enabled: 0 }, localUser);
      dependencies.writeUser(user);
      if (active) {
        if ((changed || lostCapabilities) && capabilities.some(capability => capability.startsWith('business:'))) {
          dependencies.setBusinessCacheIdentity(user);
        }
        dependencies.writeCache({ verified: true, fetchedAt: Date.now(), identity: remoteIdentity, capabilities });
        return { status: 'loaded', identity: remoteIdentity, capabilities };
      }
      dependencies.writeCache(null);
      return { status: 'loaded', identity: user, capabilities: [] };
    } catch (error) {
      if (requestId !== generation) return { status: 'stale', identity: null, capabilities: [] };
      dependencies.clearBusinessCache();
      dependencies.clearPermissionCache();
      dependencies.writeCache(null);
      return { status: 'error', identity: null, capabilities: [], error };
    }
  }
  return { refresh, getFetchCount: () => fetchCount };
}

module.exports = { createAuthorizationSession, fingerprint, isActive };
