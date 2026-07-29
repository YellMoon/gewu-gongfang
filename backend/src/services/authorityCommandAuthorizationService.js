const { resolveActingScope } = require('./authorityAccessService');
const { createAuthorityRuntimeHostEpochService } = require('./authorityRuntimeHostEpochService');

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

  const runtimeEpochs = createAuthorityRuntimeHostEpochService({ db });
  function authorize(envelope = {}) {
    const epoch = runtimeEpochs.find(envelope.hostEpochId);
    if (!epoch || epoch.authority_id !== envelope.authorityId) {
      throw authorizationError('AUTHORITY_HOST_EPOCH_INACTIVE');
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

    const roleRows = db.prepare(`SELECT role, status, authority_id, subject_id, grant_version
      FROM authority_role_bindings WHERE authority_id=? AND user_id=?`)
      .all(envelope.authorityId, envelope.actor.userId);
    let scope;
    try {
      scope = resolveActingScope({
        userId: envelope.actor.userId,
        actingRole: envelope.actor.role,
        authorityId: envelope.authorityId,
        grants: roleRows.map(row => ({
          role: row.role,
          status: row.status,
          authorityId: row.authority_id,
          bindingId: row.subject_id,
          grantVersion: row.grant_version,
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
      hostDeviceId: epoch.device_id,
      grantId: grant.grant_id,
      leaseId: lease.lease_id,
      scope: Object.freeze(scope),
    });
  }

  return Object.freeze({ authorize });
}

module.exports = { authorizationError, createAuthorityCommandAuthorizationService };
