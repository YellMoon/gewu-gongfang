const {
  hasReviewExperienceMarker,
  isReviewExperienceIdentity,
  reviewSessionIdentityKey,
} = require('./reviewExperience');

function roleOf(identity) {
  return identity && (identity.role || identity.user_type) || 'pending';
}

function fingerprint(identity) {
  if (!identity) return '';
  return [identity.id || '', roleOf(identity), identity.teacher_id || identity.teacherId || '',
    identity.student_id || identity.studentId || '', identity.review_status || '', identity.status,
    identity.login_enabled, identity.authorization_revision || identity.updated_at || '',
    identity.is_review_demo === true, identity.read_only === true, reviewSessionIdentityKey(identity)].join('|');
}

function isActive(identity) {
  const active = Boolean(identity && identity.id && identity.review_status === 'approved'
    && (identity.status === 1 || identity.status === true)
    && (identity.login_enabled === 1 || identity.login_enabled === true)
    && roleOf(identity) !== 'pending');
  if (!active) return false;
  return !hasReviewExperienceMarker(identity) || isReviewExperienceIdentity(identity);
}

function normalizedUser(identity, localUser) {
  return { ...(localUser || {}), ...identity, user_type: roleOf(identity), role: roleOf(identity) };
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
      const changed = fingerprint(remoteIdentity) !== fingerprint((cached && cached.identity) || localUser);
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
