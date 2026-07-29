function projectionVersionError(code) {
  return Object.assign(new Error(code), { code });
}

function createAuthorityProjectionVersionService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw projectionVersionError('AUTHORITY_PROJECTION_VERSION_DATABASE_REQUIRED');
  }

  function next({ authorityId, hostEpochId } = {}) {
    const normalizedAuthorityId = String(authorityId || '').trim();
    const normalizedHostEpochId = String(hostEpochId || '').trim();
    const updatedAt = new Date(now());
    if (!normalizedAuthorityId || !normalizedHostEpochId || !Number.isFinite(updatedAt.getTime())) {
      throw projectionVersionError('AUTHORITY_PROJECTION_VERSION_INPUT_INVALID');
    }
    const row = db.prepare(`INSERT INTO authority_projection_versions
      (authority_id,host_epoch_id,version,updated_at) VALUES(?,?,1,?)
      ON CONFLICT(authority_id,host_epoch_id) DO UPDATE
        SET version=authority_projection_versions.version+1, updated_at=excluded.updated_at
      RETURNING version`)
      .get(normalizedAuthorityId, normalizedHostEpochId, updatedAt.toISOString());
    return row.version;
  }

  function current({ authorityId, hostEpochId } = {}) {
    const normalizedAuthorityId = String(authorityId || '').trim();
    const normalizedHostEpochId = String(hostEpochId || '').trim();
    if (!normalizedAuthorityId || !normalizedHostEpochId) {
      throw projectionVersionError('AUTHORITY_PROJECTION_VERSION_INPUT_INVALID');
    }
    return Number(db.prepare(`SELECT version FROM authority_projection_versions
      WHERE authority_id=? AND host_epoch_id=?`)
      .get(normalizedAuthorityId, normalizedHostEpochId)?.version || 0);
  }

  return Object.freeze({ current, next });
}

module.exports = { createAuthorityProjectionVersionService, projectionVersionError };
