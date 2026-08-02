const {
  resolveCanonicalAuthorityRoleContext,
} = require('../backend/src/services/authorityRoleGrantAdapter');

function localProjectionError(code) {
  return Object.assign(new Error(code), { code });
}

function createPrimaryHostLocalProjectionReader({
  refreshControlRecords,
  hostAuthorityContext,
  resolveHostEpoch,
  materializeProjections,
  projectionStore,
  db,
  now = () => new Date(),
} = {}) {
  if (typeof refreshControlRecords !== 'function'
    || typeof hostAuthorityContext !== 'function'
    || typeof resolveHostEpoch !== 'function'
    || typeof materializeProjections !== 'function'
    || !db || typeof db.prepare !== 'function'
    || typeof now !== 'function'
    || typeof projectionStore?.read !== 'function') {
    throw localProjectionError('PRIMARY_HOST_LOCAL_PROJECTION_READER_CONFIG_REQUIRED');
  }

  function validateAccess(context) {
    const authorityId = String(context?.authorityId || '').trim();
    const userId = String(context?.actor?.userId || '').trim();
    const deviceId = String(context?.actor?.deviceId || '').trim();
    const role = String(context?.actor?.role || '').trim();
    const leaseId = String(context?.lease?.id || '').trim();
    const grantVersion = Number(context?.lease?.grantVersion);
    if (!authorityId || !userId || !deviceId || !role || !leaseId
      || !Number.isSafeInteger(grantVersion) || grantVersion < 1) {
      throw localProjectionError('AUTHORITY_PROJECTION_ACCESS_CONTEXT_INVALID');
    }
    const roleContext = resolveCanonicalAuthorityRoleContext(db, { authorityId, userId });
    if (roleContext.accountStatus !== 'active') {
      throw localProjectionError('AUTHORITY_PROJECTION_ACCOUNT_NOT_ACTIVE');
    }
    if (role !== 'visitor' && !roleContext.grants.some(grant => grant.role === role)) {
      throw localProjectionError('AUTHORITY_PROJECTION_ROLE_NOT_GRANTED');
    }
    const epoch = resolveHostEpoch(String(context.hostEpochId || '').trim());
    if (!epoch
      || epoch.authority_id !== authorityId
      || epoch.device_id !== deviceId
      || !Number.isSafeInteger(Number(epoch.generation))
      || Number(epoch.generation) < 1) {
      throw localProjectionError('AUTHORITY_PROJECTION_HOST_EPOCH_INACTIVE');
    }
    const lease = db.prepare(`SELECT grant_id,authority_id,device_id,user_id,active_role,grant_version,
      status,expires_at,revoked_at FROM device_leases WHERE lease_id=?`).get(leaseId);
    const currentTime = new Date(now()).getTime();
    if (!Number.isFinite(currentTime)
      || !lease
      || lease.authority_id !== authorityId
      || lease.device_id !== deviceId
      || lease.user_id !== userId
      || lease.active_role !== role
      || lease.status !== 'active'
      || lease.revoked_at
      || !Number.isFinite(Date.parse(lease.expires_at))
      || Date.parse(lease.expires_at) <= currentTime) {
      throw localProjectionError('AUTHORITY_PROJECTION_LEASE_INACTIVE');
    }
    const grant = db.prepare(`SELECT grant_id,authority_id,device_id,user_id,host_generation,
      status,grant_version,revoked_at FROM device_grants WHERE grant_id=?`).get(lease.grant_id);
    if (!grant || grant.status !== 'active' || grant.revoked_at) {
      throw localProjectionError('AUTHORITY_PROJECTION_DEVICE_GRANT_INACTIVE');
    }
    if (grant.authority_id !== authorityId
      || grant.device_id !== deviceId
      || grant.user_id !== userId
      || Number(grant.host_generation) !== Number(epoch.generation)) {
      throw localProjectionError('AUTHORITY_PROJECTION_DEVICE_GRANT_SCOPE_MISMATCH');
    }
    if (Number(grant.grant_version) !== grantVersion
      || Number(lease.grant_version) !== grantVersion) {
      throw localProjectionError('AUTHORITY_PROJECTION_GRANT_VERSION_STALE');
    }
  }

  return async ({ minSourceVersion = 0 } = {}) => {
    const minimum = Number(minSourceVersion || 0);
    if (!Number.isSafeInteger(minimum) || minimum < 0) {
      throw localProjectionError('AUTHORITY_PROJECTION_VERSION_INVALID');
    }
    try {
      await refreshControlRecords();
    } catch (_error) {
      // Cached control records remain usable while the cloud is unavailable.
    }
    const context = await hostAuthorityContext();
    validateAccess(context);
    const materialized = await materializeProjections({
      authorityId: context.authorityId,
      hostEpochId: context.hostEpochId,
    });
    if (Number(materialized?.failed || 0) > 0) {
      throw localProjectionError('AUTHORITY_PROJECTION_MATERIALIZE_PARTIAL_FAILURE');
    }
    validateAccess(context);
    const projection = projectionStore.read({
      authorityId: context.authorityId,
      userId: context.actor.userId,
      role: context.actor.role,
    });
    if (!projection) throw localProjectionError('AUTHORITY_PROJECTION_NOT_FOUND');
    if (projection.authorityId !== context.authorityId
      || projection.hostEpochId !== context.hostEpochId
      || projection.userId !== context.actor.userId
      || projection.role !== context.actor.role) {
      throw localProjectionError('AUTHORITY_PROJECTION_SCOPE_MISMATCH');
    }
    if (Number(projection.sourceVersion) < minimum) {
      throw localProjectionError('AUTHORITY_PROJECTION_VERSION_PENDING');
    }
    return projection;
  };
}

module.exports = { createPrimaryHostLocalProjectionReader, localProjectionError };
