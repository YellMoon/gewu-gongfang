const {
  normalizedProjection,
} = require('../../../shared/authorityProjectionProtocol');
const { stableJson } = require('../../../shared/authorityProtocol');

function projectionStoreError(code, statusCode = 409) {
  return Object.assign(new Error(code), { code, statusCode });
}

function createAuthorityProjectionStoreService({ db } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw projectionStoreError('AUTHORITY_PROJECTION_STORE_DATABASE_REQUIRED', 500);
  }
  const find = db.prepare(`SELECT * FROM authority_scoped_projections
    WHERE authority_id=? AND user_id=? AND role=?`);

  function read({ authorityId, userId, role } = {}) {
    const row = find.get(
      String(authorityId || '').trim(),
      String(userId || '').trim(),
      String(role || '').trim()
    );
    return row ? JSON.parse(row.document_json) : null;
  }

  function publish(input) {
    const normalized = normalizedProjection(input);
    const signature = String(input?.signature || '').trim();
    if (!signature) throw projectionStoreError('AUTHORITY_PROJECTION_SIGNATURE_REQUIRED', 400);
    const document = Object.freeze({ ...normalized, signature });
    const existing = find.get(normalized.authorityId, normalized.userId, normalized.role);
    if (existing) {
      if (Number(existing.source_version) > normalized.sourceVersion) {
        throw projectionStoreError('AUTHORITY_PROJECTION_VERSION_STALE');
      }
      if (Number(existing.source_version) === normalized.sourceVersion) {
        if (existing.payload_hash !== normalized.payloadHash
          || existing.host_epoch_id !== normalized.hostEpochId
          || existing.signature !== signature) {
          throw projectionStoreError('AUTHORITY_PROJECTION_VERSION_CONFLICT');
        }
        return Object.freeze({ ...document, replayed: true });
      }
    }
    db.prepare(`INSERT INTO authority_scoped_projections
      (authority_id,host_epoch_id,user_id,role,source_version,payload_hash,document_json,signature,generated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(authority_id,user_id,role) DO UPDATE SET
        host_epoch_id=excluded.host_epoch_id,
        source_version=excluded.source_version,
        payload_hash=excluded.payload_hash,
        document_json=excluded.document_json,
        signature=excluded.signature,
        generated_at=excluded.generated_at`)
      .run(
        normalized.authorityId,
        normalized.hostEpochId,
        normalized.userId,
        normalized.role,
        normalized.sourceVersion,
        normalized.payloadHash,
        stableJson(document),
        signature,
        normalized.generatedAt
      );
    return Object.freeze({ ...document, replayed: false });
  }

  return Object.freeze({ publish, read });
}

module.exports = { createAuthorityProjectionStoreService, projectionStoreError };
