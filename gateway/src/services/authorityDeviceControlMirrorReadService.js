'use strict';

function readServiceError(code) {
  return Object.assign(new Error(code), { code });
}

function createAuthorityDeviceControlMirrorReadService({ db } = {}) {
  if (!db?.prepare) throw readServiceError('AUTHORITY_DEVICE_CONTROL_MIRROR_READ_DATABASE_REQUIRED');

  function load({ authorityId, hostEpochId, hostGeneration } = {}) {
    const authority = String(authorityId || '').trim();
    const epochId = String(hostEpochId || '').trim();
    const generation = Number(hostGeneration);
    if (!authority || !epochId || !Number.isSafeInteger(generation) || generation < 1) {
      throw readServiceError('AUTHORITY_DEVICE_CONTROL_MIRROR_READ_SCOPE_INVALID');
    }
    const version = db.prepare(`SELECT source_version FROM authority_device_control_mirror_versions
      WHERE authority_id=? AND host_epoch_id=? AND host_generation=?`)
      .get(authority, epochId, generation);
    const accounts = db.prepare(`SELECT user_id AS userId, authority_id AS authorityId, status,
      created_at AS createdAt, updated_at AS updatedAt
      FROM authority_accounts WHERE authority_id=? ORDER BY user_id`).all(authority);
    const grants = db.prepare(`SELECT grant_id AS grantId, authority_id AS authorityId,
      device_id AS deviceId, user_id AS userId, public_key AS publicKey,
      host_generation AS hostGeneration, status, grant_version AS grantVersion,
      approved_by AS approvedBy, created_at AS createdAt, updated_at AS updatedAt,
      revoked_at AS revokedAt FROM device_grants WHERE authority_id=? ORDER BY grant_id`).all(authority);
    const leases = db.prepare(`SELECT lease_id AS leaseId, grant_id AS grantId,
      authority_id AS authorityId, device_id AS deviceId, user_id AS userId,
      active_role AS activeRole, grant_version AS grantVersion, status,
      issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt
      FROM device_leases WHERE authority_id=? ORDER BY lease_id`).all(authority);
    const roleBindings = db.prepare(`SELECT binding_id AS bindingId, authority_id AS authorityId,
      user_id AS userId, role, subject_type AS subjectType, subject_id AS subjectId, status,
      grant_version AS grantVersion, granted_by AS grantedBy, created_at AS createdAt,
      updated_at AS updatedAt, revoked_at AS revokedAt
      FROM authority_role_bindings WHERE authority_id=? ORDER BY binding_id`).all(authority);
    return Object.freeze({
      authorityId: authority,
      hostEpochId: epochId,
      hostGeneration: generation,
      sourceVersion: Number(version?.source_version || 0),
      accounts: Object.freeze(accounts),
      grants: Object.freeze(grants),
      leases: Object.freeze(leases),
      roleBindings: Object.freeze(roleBindings),
    });
  }

  return Object.freeze({ load });
}

module.exports = { createAuthorityDeviceControlMirrorReadService, readServiceError };
