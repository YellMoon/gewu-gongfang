function sourceError(code) {
  return Object.assign(new Error(code), { code });
}
const { createAuthorityRuntimeHostEpochService } = require('./authorityRuntimeHostEpochService');

function createAuthorityControlMirrorSourceService({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw sourceError('AUTHORITY_CONTROL_MIRROR_SOURCE_DATABASE_REQUIRED');
  }

  const runtimeEpochs = createAuthorityRuntimeHostEpochService({ db });
  function load({ authorityId, hostEpochId } = {}) {
    const authority = String(authorityId || '').trim();
    const epochId = String(hostEpochId || '').trim();
    const epoch = runtimeEpochs.find(epochId);
    if (!epoch || epoch.authority_id !== authority) throw sourceError('AUTHORITY_CONTROL_MIRROR_EPOCH_INACTIVE');
    const sourceVersion = Number(db.prepare(`SELECT version
      FROM authority_projection_versions WHERE authority_id=? AND host_epoch_id=?`)
      .get(authority, epochId)?.version || 0);
    const accounts = db.prepare(`SELECT
        user_id AS userId, authority_id AS authorityId, status,
        created_at AS createdAt, updated_at AS updatedAt
      FROM authority_accounts WHERE authority_id=? ORDER BY user_id`).all(authority);
    const grants = db.prepare(`SELECT
        grant_id AS grantId, authority_id AS authorityId, device_id AS deviceId,
        user_id AS userId, public_key AS publicKey, host_generation AS hostGeneration,
        status, grant_version AS grantVersion, approved_by AS approvedBy,
        created_at AS createdAt, updated_at AS updatedAt, revoked_at AS revokedAt
      FROM device_grants WHERE authority_id=? ORDER BY grant_id`).all(authority);
    const leases = db.prepare(`SELECT
        lease_id AS leaseId, grant_id AS grantId, authority_id AS authorityId,
        device_id AS deviceId, user_id AS userId, active_role AS activeRole,
        grant_version AS grantVersion, status, issued_at AS issuedAt,
        expires_at AS expiresAt, revoked_at AS revokedAt
      FROM device_leases WHERE authority_id=? ORDER BY lease_id`).all(authority);
    const hasRoleBindings = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='authority_role_bindings'").get());
    const roleBindings = hasRoleBindings ? db.prepare(`SELECT binding_id AS bindingId, authority_id AS authorityId,
      user_id AS userId, role, subject_type AS subjectType, subject_id AS subjectId, status,
      grant_version AS grantVersion, granted_by AS grantedBy, created_at AS createdAt,
      updated_at AS updatedAt, revoked_at AS revokedAt
      FROM authority_role_bindings WHERE authority_id=? ORDER BY binding_id`).all(authority) : [];
    return Object.freeze({
      authorityId: authority,
      hostEpochId: epochId,
      hostGeneration: Number(epoch.generation),
      sourceVersion,
      accounts: Object.freeze(accounts),
      grants: Object.freeze(grants),
      leases: Object.freeze(leases),
      roleBindings: Object.freeze(roleBindings),
    });
  }

  return Object.freeze({ load });
}

module.exports = {
  createAuthorityControlMirrorSourceService,
  sourceError,
};
