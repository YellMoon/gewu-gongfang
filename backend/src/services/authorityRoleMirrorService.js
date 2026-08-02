const { stableJson } = require('../../../shared/authorityProtocol');

function mirrorError(code, statusCode = 409) {
  return Object.assign(new Error(code), { code, statusCode });
}

function text(value, code, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw mirrorError(code, 400);
  return normalized;
}

function list(value, code) {
  if (!Array.isArray(value)) throw mirrorError(code, 400);
  return value;
}

function createAuthorityRoleMirrorService({ db } = {}) {
  if (!db?.prepare || !db?.transaction) {
    throw mirrorError('AUTHORITY_ROLE_MIRROR_DATABASE_REQUIRED', 500);
  }
  const findVersion = db.prepare(
    'SELECT * FROM authority_role_mirror_versions WHERE authority_id=?'
  );
  const insertApplication = db.prepare(`INSERT INTO role_application_mirrors
    (authority_id,application_id,host_epoch_id,source_version,user_id,requested_role,status,
     payload_json,projection_signature,generated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const insertGrant = db.prepare(`INSERT INTO role_grant_mirrors
    (authority_id,binding_id,host_epoch_id,source_version,user_id,role,grant_version,status,
     payload_json,projection_signature,generated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const insertAuthorizationGrant = db.prepare(`INSERT INTO authority_role_bindings
    (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
     granted_by,created_at,updated_at,revoked_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);

  const replace = db.transaction(projection => {
    if (projection?.role !== 'super_admin') {
      throw mirrorError('AUTHORITY_ROLE_MIRROR_SUPER_ADMIN_PROJECTION_REQUIRED', 403);
    }
    const authorityId = text(projection.authorityId, 'AUTHORITY_ROLE_MIRROR_AUTHORITY_REQUIRED');
    const hostEpochId = text(projection.hostEpochId, 'AUTHORITY_ROLE_MIRROR_EPOCH_REQUIRED');
    const signature = text(projection.signature, 'AUTHORITY_ROLE_MIRROR_SIGNATURE_REQUIRED', 2048);
    const payloadHash = text(projection.payloadHash, 'AUTHORITY_ROLE_MIRROR_PAYLOAD_HASH_REQUIRED', 128);
    const generatedAt = text(projection.generatedAt, 'AUTHORITY_ROLE_MIRROR_TIMESTAMP_REQUIRED', 64);
    const sourceVersion = Number(projection.sourceVersion);
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0) {
      throw mirrorError('AUTHORITY_ROLE_MIRROR_VERSION_INVALID', 400);
    }
    const applications = list(
      projection.payload?.roleApplications,
      'AUTHORITY_ROLE_APPLICATION_MIRRORS_INVALID',
    );
    const grants = list(projection.payload?.roleGrants, 'AUTHORITY_ROLE_GRANT_MIRRORS_INVALID');
    for (const application of applications) {
      if (application?.authorityId !== authorityId) {
        throw mirrorError('AUTHORITY_ROLE_MIRROR_AUTHORITY_MISMATCH', 400);
      }
      text(application.applicationId, 'AUTHORITY_ROLE_APPLICATION_MIRROR_ID_INVALID');
      text(application.userId, 'AUTHORITY_ROLE_APPLICATION_MIRROR_USER_INVALID');
      if (!['student', 'teacher'].includes(application.requestedRole)
        || !['pending', 'approved', 'rejected', 'withdrawn'].includes(application.status)) {
        throw mirrorError('AUTHORITY_ROLE_APPLICATION_MIRROR_INVALID', 400);
      }
    }
    for (const grant of grants) {
      if (grant?.authorityId !== authorityId) {
        throw mirrorError('AUTHORITY_ROLE_MIRROR_AUTHORITY_MISMATCH', 400);
      }
      text(grant.bindingId, 'AUTHORITY_ROLE_GRANT_MIRROR_ID_INVALID');
      text(grant.userId, 'AUTHORITY_ROLE_GRANT_MIRROR_USER_INVALID');
      if (!['student', 'teacher', 'admin', 'super_admin'].includes(grant.role)
        || !['active', 'revoked', 'pending'].includes(grant.status)
        || !Number.isSafeInteger(Number(grant.grantVersion))
        || Number(grant.grantVersion) < 1) {
        throw mirrorError('AUTHORITY_ROLE_GRANT_MIRROR_INVALID', 400);
      }
    }
    const current = findVersion.get(authorityId);
    const sameEpoch = current?.host_epoch_id === hostEpochId;
    if (sameEpoch && Number(current.source_version) > sourceVersion) {
      throw mirrorError('AUTHORITY_ROLE_MIRROR_VERSION_STALE');
    }
    if (sameEpoch && Number(current.source_version) === sourceVersion) {
      if (current.payload_hash !== payloadHash) {
        throw mirrorError('AUTHORITY_ROLE_MIRROR_VERSION_CONFLICT');
      }
      return Object.freeze({ authorityId, sourceVersion, applications: applications.length,
        grants: grants.length, replayed: true });
    }
    db.prepare('DELETE FROM role_application_mirrors WHERE authority_id=?').run(authorityId);
    db.prepare('DELETE FROM role_grant_mirrors WHERE authority_id=?').run(authorityId);
    db.prepare('DELETE FROM authority_role_bindings WHERE authority_id=?').run(authorityId);
    for (const application of applications) {
      insertApplication.run(authorityId, application.applicationId, hostEpochId, sourceVersion,
        application.userId, application.requestedRole, application.status,
        stableJson(application), signature, generatedAt);
    }
    for (const grant of grants) {
      insertGrant.run(authorityId, grant.bindingId, hostEpochId, sourceVersion, grant.userId,
        grant.role, Number(grant.grantVersion), grant.status, stableJson(grant), signature,
        generatedAt);
      insertAuthorizationGrant.run(grant.bindingId, authorityId, grant.userId, grant.role,
        grant.subjectType || null, grant.subjectId || null, grant.status,
        Number(grant.grantVersion), grant.grantedBy || null, grant.createdAt || generatedAt,
        grant.updatedAt || generatedAt, grant.revokedAt || null);
    }
    db.prepare(`INSERT INTO authority_role_mirror_versions
      (authority_id,host_epoch_id,source_version,payload_hash,projection_signature,generated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(authority_id) DO UPDATE SET host_epoch_id=excluded.host_epoch_id,
        source_version=excluded.source_version,payload_hash=excluded.payload_hash,
        projection_signature=excluded.projection_signature,generated_at=excluded.generated_at`)
      .run(authorityId, hostEpochId, sourceVersion, payloadHash, signature, generatedAt);
    return Object.freeze({ authorityId, sourceVersion, applications: applications.length,
      grants: grants.length, replayed: false });
  });

  return Object.freeze({ replaceFromVerifiedProjection: projection => replace(projection) });
}

module.exports = { createAuthorityRoleMirrorService, mirrorError };
