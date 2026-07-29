const crypto = require('crypto');
const { stableJson } = require('../../../shared/authorityProtocol');

function mirrorError(code, statusCode = 409) {
  return Object.assign(new Error(code), { code, statusCode });
}

function requiredText(value, code, maxLength = 8192) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw mirrorError(code, 400);
  return normalized;
}

function validTimestamp(value, code) {
  const normalized = requiredText(value, code, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw mirrorError(code, 400);
  return new Date(normalized).toISOString();
}

function createAuthorityDeviceControlMirrorService({
  db,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_DATABASE_REQUIRED', 500);
  }

  const replaceTransaction = db.transaction(snapshot => {
    const authorityId = requiredText(
      snapshot?.authorityId,
      'AUTHORITY_DEVICE_CONTROL_MIRROR_AUTHORITY_REQUIRED',
      128,
    );
    const hostEpochId = requiredText(
      snapshot?.hostEpochId,
      'AUTHORITY_DEVICE_CONTROL_MIRROR_EPOCH_REQUIRED',
      128,
    );
    const hostGeneration = Number(snapshot?.hostGeneration);
    const sourceVersion = Number(snapshot?.sourceVersion);
    if (!Number.isSafeInteger(hostGeneration) || hostGeneration < 1
      || !Number.isSafeInteger(sourceVersion) || sourceVersion < 0
      || !Array.isArray(snapshot?.accounts)
      || !Array.isArray(snapshot?.grants)
      || !Array.isArray(snapshot?.leases)
      || !Array.isArray(snapshot?.roleBindings)) {
      throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_INVALID', 400);
    }
    const normalized = {
      authorityId,
      hostEpochId,
      hostGeneration,
      sourceVersion,
      accounts: snapshot.accounts,
      grants: snapshot.grants,
      leases: snapshot.leases,
      roleBindings: snapshot.roleBindings,
    };
    const snapshotHash = crypto.createHash('sha256').update(stableJson(normalized)).digest('hex');
    const grantIds = new Set();
    for (const account of normalized.accounts) {
      if (account?.authorityId !== authorityId
        || !['active', 'disabled'].includes(account?.status)) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_SCOPE_MISMATCH', 400);
      }
      requiredText(account.userId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_USER_INVALID', 128);
      validTimestamp(account.createdAt, 'AUTHORITY_DEVICE_CONTROL_MIRROR_TIMESTAMP_INVALID');
      validTimestamp(account.updatedAt, 'AUTHORITY_DEVICE_CONTROL_MIRROR_TIMESTAMP_INVALID');
    }
    for (const grant of normalized.grants) {
      if (grant?.authorityId !== authorityId
        || Number(grant?.hostGeneration) !== hostGeneration) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_SCOPE_MISMATCH', 400);
      }
      const grantId = requiredText(
        grant.grantId,
        'AUTHORITY_DEVICE_CONTROL_MIRROR_GRANT_INVALID',
        128,
      );
      requiredText(grant.deviceId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_DEVICE_INVALID', 128);
      requiredText(grant.userId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_USER_INVALID', 128);
      requiredText(grant.publicKey, 'AUTHORITY_DEVICE_CONTROL_MIRROR_PUBLIC_KEY_INVALID');
      if (!['pending', 'active', 'revoked', 'expired'].includes(grant.status)
        || !Number.isSafeInteger(Number(grant.grantVersion))
        || Number(grant.grantVersion) < 1) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_GRANT_INVALID', 400);
      }
      grantIds.add(grantId);
    }
    for (const lease of normalized.leases) {
      if (lease?.authorityId !== authorityId) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_SCOPE_MISMATCH', 400);
      }
      requiredText(lease.leaseId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_LEASE_INVALID', 128);
      if (!grantIds.has(String(lease.grantId || '').trim())) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_GRANT_MISSING', 400);
      }
      if (!['visitor', 'student', 'teacher', 'admin', 'super_admin'].includes(lease.activeRole)
        || !['active', 'expired', 'revoked'].includes(lease.status)
        || !Number.isSafeInteger(Number(lease.grantVersion))
        || Number(lease.grantVersion) < 1) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_LEASE_INVALID', 400);
      }
      validTimestamp(lease.issuedAt, 'AUTHORITY_DEVICE_CONTROL_MIRROR_TIMESTAMP_INVALID');
      validTimestamp(lease.expiresAt, 'AUTHORITY_DEVICE_CONTROL_MIRROR_TIMESTAMP_INVALID');
    }
    for (const binding of normalized.roleBindings) {
      if (binding?.authorityId !== authorityId
        || !['student', 'teacher', 'admin', 'super_admin'].includes(binding?.role)
        || !['active', 'revoked', 'pending'].includes(binding?.status)
        || !Number.isSafeInteger(Number(binding?.grantVersion)) || Number(binding.grantVersion) < 1) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_ROLE_INVALID', 400);
      }
      requiredText(binding.bindingId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_ROLE_INVALID', 128);
      requiredText(binding.userId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_USER_INVALID', 128);
      validTimestamp(binding.createdAt, 'AUTHORITY_DEVICE_CONTROL_MIRROR_TIMESTAMP_INVALID');
      validTimestamp(binding.updatedAt, 'AUTHORITY_DEVICE_CONTROL_MIRROR_TIMESTAMP_INVALID');
    }
    const current = db.prepare(`SELECT * FROM authority_device_control_mirror_versions
      WHERE authority_id=?`).get(authorityId);
    if (current && Number(current.source_version) > sourceVersion) {
      throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_VERSION_STALE');
    }
    if (current && Number(current.source_version) === sourceVersion) {
      if (current.host_epoch_id !== hostEpochId
        || Number(current.host_generation) !== hostGeneration
        || current.snapshot_hash !== snapshotHash) {
        throw mirrorError('AUTHORITY_DEVICE_CONTROL_MIRROR_VERSION_CONFLICT');
      }
      return Object.freeze({
        authorityId,
        sourceVersion,
        accounts: normalized.accounts.length,
        grants: normalized.grants.length,
        leases: normalized.leases.length,
        roleBindings: normalized.roleBindings.length,
        replayed: true,
      });
    }
    db.prepare('DELETE FROM device_leases WHERE authority_id=?').run(authorityId);
    db.prepare('DELETE FROM device_grants WHERE authority_id=?').run(authorityId);
    db.prepare('DELETE FROM authority_accounts WHERE authority_id=?').run(authorityId);
    db.prepare('DELETE FROM authority_role_bindings WHERE authority_id=?').run(authorityId);
    for (const account of normalized.accounts) {
      db.prepare(`INSERT INTO authority_accounts
        (user_id,authority_id,status,created_at,updated_at) VALUES(?,?,?,?,?)`)
        .run(account.userId, authorityId, account.status, account.createdAt, account.updatedAt);
    }
    for (const grant of normalized.grants) {
      db.prepare(`INSERT INTO device_grants
        (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,
         approved_by,created_at,updated_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          grant.grantId,
          authorityId,
          grant.deviceId,
          grant.userId,
          grant.publicKey,
          hostGeneration,
          grant.status,
          Number(grant.grantVersion),
          grant.approvedBy || null,
          grant.createdAt,
          grant.updatedAt,
          grant.revokedAt || null,
        );
    }
    for (const lease of normalized.leases) {
      db.prepare(`INSERT INTO device_leases
        (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,
         issued_at,expires_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          lease.leaseId,
          lease.grantId,
          authorityId,
          lease.deviceId,
          lease.userId,
          lease.activeRole,
          Number(lease.grantVersion),
          lease.status,
          lease.issuedAt,
          lease.expiresAt,
          lease.revokedAt || null,
        );
    }
    for (const binding of normalized.roleBindings) {
      db.prepare(`INSERT INTO authority_role_bindings
        (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
         granted_by,created_at,updated_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(binding.bindingId, authorityId, binding.userId, binding.role,
          binding.subjectType || null, binding.subjectId || null, binding.status,
          Number(binding.grantVersion), binding.grantedBy || null, binding.createdAt,
          binding.updatedAt, binding.revokedAt || null);
    }
    const updatedAt = validTimestamp(now(), 'AUTHORITY_DEVICE_CONTROL_MIRROR_CLOCK_INVALID');
    db.prepare(`INSERT INTO authority_device_control_mirror_versions
      (authority_id,host_epoch_id,host_generation,source_version,snapshot_hash,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(authority_id) DO UPDATE SET
        host_epoch_id=excluded.host_epoch_id,
        host_generation=excluded.host_generation,
        source_version=excluded.source_version,
        snapshot_hash=excluded.snapshot_hash,
        updated_at=excluded.updated_at`)
      .run(authorityId, hostEpochId, hostGeneration, sourceVersion, snapshotHash, updatedAt);
    return Object.freeze({
      authorityId,
      sourceVersion,
      accounts: normalized.accounts.length,
      grants: normalized.grants.length,
      leases: normalized.leases.length,
      roleBindings: normalized.roleBindings.length,
      replayed: false,
    });
  });

  return Object.freeze({ replace: snapshot => replaceTransaction(snapshot) });
}

module.exports = {
  createAuthorityDeviceControlMirrorService,
  mirrorError,
};
