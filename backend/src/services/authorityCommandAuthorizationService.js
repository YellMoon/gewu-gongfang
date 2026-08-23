const { resolveActingScope } = require('./authorityAccessService');
const { createAuthorityCloudEpochService } = require('./authorityCloudEpochService');
const { resolveCanonicalAuthorityRoleContext } = require('./authorityRoleGrantAdapter');

function authorizationError(code, statusCode = 403) {
  return Object.assign(new Error(code), { code, statusCode });
}

function createAuthorityCommandAuthorizationService({
  db,
  now = () => new Date(),
  commandPolicy = () => false,
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw authorizationError('AUTHORITY_AUTHORIZATION_DATABASE_REQUIRED', 500);
  }
  if (typeof commandPolicy !== 'function') {
    throw authorizationError('AUTHORITY_COMMAND_POLICY_REQUIRED', 500);
  }

  const cloudEpochs = createAuthorityCloudEpochService({ db });
  function authorize(envelope = {}) {
    const epoch = cloudEpochs.find(envelope.hostEpochId);
    if (!epoch || epoch.authority_id !== envelope.authorityId) {
      throw authorizationError('AUTHORITY_CLOUD_EPOCH_INACTIVE');
    }

    const grant = db.prepare(`SELECT * FROM device_grants
      WHERE authority_id=? AND device_id=? AND user_id=? AND status='active'`)
      .get(envelope.authorityId, envelope.actor?.deviceId, envelope.actor?.userId);
    if (!grant) throw authorizationError('DEVICE_GRANT_INACTIVE');
    if (Number(grant.grant_version) !== Number(envelope.lease?.grantVersion)) {
      throw authorizationError('DEVICE_LEASE_GRANT_VERSION_STALE');
    }

    const lease = db.prepare(`SELECT * FROM device_leases
      WHERE lease_id=? AND grant_id=? AND authority_id=? AND device_id=? AND user_id=?`)
      .get(
        envelope.lease?.id,
        grant.grant_id,
        envelope.authorityId,
        envelope.actor?.deviceId,
        envelope.actor?.userId,
      );
    if (!lease || lease.status !== 'active' || lease.revoked_at) {
      throw authorizationError('DEVICE_LEASE_INACTIVE');
    }
    const current = now();
    const currentTime = current instanceof Date ? current.getTime() : Date.parse(current);
    if (!Number.isFinite(currentTime) || Date.parse(lease.expires_at) <= currentTime) {
      throw authorizationError('DEVICE_LEASE_EXPIRED');
    }
    if (Number(lease.grant_version) !== Number(grant.grant_version)
      || lease.active_role !== envelope.actor?.role) {
      throw authorizationError('DEVICE_LEASE_SCOPE_MISMATCH');
    }

    let roleContext;
    try {
      roleContext = resolveCanonicalAuthorityRoleContext(db, {
        authorityId: envelope.authorityId,
        userId: envelope.actor.userId,
      });
    } catch (error) {
      throw authorizationError(error?.code || 'ACTING_ROLE_NOT_GRANTED');
    }
    if (roleContext.accountStatus !== 'active') {
      throw authorizationError('ACTING_ROLE_NOT_GRANTED');
    }
    let scope;
    try {
      scope = resolveActingScope({
        userId: envelope.actor.userId,
        actingRole: envelope.actor.role,
        authorityId: envelope.authorityId,
        grants: roleContext.grants.map(grant => ({
          role: grant.role,
          status: grant.status,
          authorityId: grant.authorityId,
          bindingId: grant.subjectId,
          grantVersion: grant.grantVersion,
        })),
      });
    } catch (error) {
      throw authorizationError(error?.code || 'ACTING_ROLE_NOT_GRANTED');
    }
    if (!commandPolicy({ type: envelope.type, payload: envelope.payload, scope, envelope })) {
      throw authorizationError('AUTHORITY_COMMAND_SCOPE_FORBIDDEN');
    }
    return Object.freeze({
      authorityId: envelope.authorityId,
      hostEpochId: envelope.hostEpochId,
      authorityEpochGeneration: Number(epoch.generation),
      grantId: grant.grant_id,
      leaseId: lease.lease_id,
      scope: Object.freeze(scope),
    });
  }

  return Object.freeze({ authorize });
}

module.exports = { authorizationError, createAuthorityCommandAuthorizationService };
