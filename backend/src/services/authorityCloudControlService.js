const {
  verifySignedAuthorityProjection,
} = require('../../../shared/authorityProjectionProtocol');
const {
  validatePrimaryHostSigningPublicKey,
} = require('../../../shared/primaryHostSigningKey');
const {
  createAuthorityProjectionStoreService,
} = require('./authorityProjectionStoreService');
const {
  createAuthorityRoleMirrorService,
} = require('./authorityRoleMirrorService');

function controlError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function requiredText(value, code, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw controlError(code);
  return normalized;
}

function timestamp(value, code) {
  const normalized = requiredText(value, code, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw controlError(code);
  return new Date(normalized).toISOString();
}

function createAuthorityCloudControlService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db?.prepare || !db?.transaction) {
    throw controlError('AUTHORITY_CLOUD_CONTROL_DATABASE_REQUIRED', 500);
  }
  const projections = createAuthorityProjectionStoreService({ db });
  const roleMirrors = createAuthorityRoleMirrorService({ db });

  function publishEpoch({ host, epoch } = {}) {
    if (String(epoch?.id || '') !== host?.id
      || String(epoch?.authorityId || '') !== host?.dbAuthorityId
      || String(epoch?.deviceId || '') !== host?.deviceId
      || Number(epoch?.generation) !== Number(host?.generation)) {
      throw controlError('AUTHORITY_HOST_EPOCH_MIRROR_MISMATCH', 403);
    }
    let signingKey;
    try {
      signingKey = validatePrimaryHostSigningPublicKey(epoch.hostSigningKey);
    } catch (error) {
      throw controlError(error?.code || 'PRIMARY_HOST_SIGNING_PUBLIC_KEY_INVALID');
    }
    const updated = db.prepare(`UPDATE primary_host_epochs
      SET host_public_key=?,updated_at=?
      WHERE id=? AND db_authority_id=? AND device_id=? AND generation=? AND status='active'`)
      .run(
        signingKey.publicKeyPem,
        timestamp(now(), 'AUTHORITY_CLOUD_CONTROL_CLOCK_INVALID'),
        host.id,
        host.dbAuthorityId,
        host.deviceId,
        Number(host.generation),
      );
    if (updated.changes !== 1) throw controlError('AUTHORITY_HOST_EPOCH_INACTIVE', 403);
    return Object.freeze({
      id: host.id,
      authorityId: host.dbAuthorityId,
      deviceId: host.deviceId,
      generation: Number(host.generation),
      hostPublicKey: signingKey.publicKeyPem,
    });
  }

  function readEpoch({ host } = {}) {
    const epoch = db.prepare(`SELECT id,db_authority_id AS authorityId,device_id AS deviceId,
      generation,host_public_key AS hostPublicKey
      FROM primary_host_epochs WHERE id=? AND status='active'`).get(host?.id);
    if (!epoch || epoch.authorityId !== host?.dbAuthorityId || epoch.deviceId !== host?.deviceId
      || Number(epoch.generation) !== Number(host?.generation) || !epoch.hostPublicKey) {
      throw controlError('AUTHORITY_HOST_EPOCH_INACTIVE', 403);
    }
    return Object.freeze(epoch);
  }

  function acceptCompatibilityControlPublish({ host, snapshot } = {}) {
    const authorityId = requiredText(snapshot?.authorityId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_AUTHORITY_REQUIRED');
    const hostEpochId = requiredText(snapshot?.hostEpochId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_EPOCH_REQUIRED');
    const hostGeneration = Number(snapshot?.hostGeneration);
    const sourceVersion = Number(snapshot?.sourceVersion);
    if (authorityId !== host?.dbAuthorityId || hostEpochId !== host?.id
      || hostGeneration !== Number(host?.generation)) {
      throw controlError('AUTHORITY_DEVICE_CONTROL_MIRROR_HOST_MISMATCH', 403);
    }
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0
      || !Array.isArray(snapshot?.accounts) || !Array.isArray(snapshot?.grants)
      || !Array.isArray(snapshot?.leases) || !Array.isArray(snapshot?.roleBindings)) {
      throw controlError('AUTHORITY_DEVICE_CONTROL_MIRROR_INVALID');
    }
    return Object.freeze({
      authorityId,
      sourceVersion,
      acceptedForCompatibility: true,
      authorizationChanged: false,
    });
  }

  function readControls({ host } = {}) {
    const authorityId = requiredText(host?.dbAuthorityId, 'AUTHORITY_DEVICE_CONTROL_MIRROR_AUTHORITY_REQUIRED');
    const accounts = db.prepare(`SELECT a.user_id AS userId,a.authority_id AS authorityId,a.status,
      u.phone,u.name,u.nickname,u.avatar_url AS avatarUrl,
      a.created_at AS createdAt,a.updated_at AS updatedAt FROM authority_accounts a
      INNER JOIN users u ON u.id=a.user_id
      WHERE a.authority_id=? ORDER BY a.user_id`).all(authorityId);
    const grants = db.prepare(`SELECT grant_id AS grantId,authority_id AS authorityId,
      device_id AS deviceId,user_id AS userId,public_key AS publicKey,
      host_generation AS hostGeneration,status,grant_version AS grantVersion,
      approved_by AS approvedBy,created_at AS createdAt,updated_at AS updatedAt,
      revoked_at AS revokedAt FROM device_grants WHERE authority_id=? ORDER BY grant_id`).all(authorityId);
    const leases = db.prepare(`SELECT lease_id AS leaseId,grant_id AS grantId,
      authority_id AS authorityId,device_id AS deviceId,user_id AS userId,
      active_role AS activeRole,grant_version AS grantVersion,status,
      issued_at AS issuedAt,expires_at AS expiresAt,revoked_at AS revokedAt
      FROM device_leases WHERE authority_id=? ORDER BY lease_id`).all(authorityId);
    const sourceVersion = [...accounts, ...grants, ...leases].reduce((maximum, item) => {
      const candidate = Date.parse(item.updatedAt || item.issuedAt || item.createdAt || 0);
      return Number.isFinite(candidate) ? Math.max(maximum, candidate) : maximum;
    }, 0);
    return Object.freeze({
      authorityId,
      hostEpochId: host.id,
      hostGeneration: Number(host.generation),
      sourceVersion,
      accounts: Object.freeze(accounts),
      grants: Object.freeze(grants),
      leases: Object.freeze(leases),
      roleBindings: Object.freeze([]),
    });
  }

  function publishProjection({ host, projection } = {}) {
    if (String(projection?.hostEpochId || '') !== host?.id
      || String(projection?.authorityId || '') !== host?.dbAuthorityId) {
      throw controlError('AUTHORITY_PROJECTION_HOST_EPOCH_MISMATCH', 403);
    }
    const epoch = readEpoch({ host });
    let verified;
    try {
      verified = verifySignedAuthorityProjection({ projection, publicKey: epoch.hostPublicKey });
    } catch (error) {
      throw controlError(error?.code || 'AUTHORITY_PROJECTION_SIGNATURE_INVALID');
    }
    const published = projections.publish(verified);
    if (verified.role === 'super_admin') {
      roleMirrors.replaceFromVerifiedProjection(verified);
    }
    return published;
  }

  return Object.freeze({
    publishEpoch,
    readEpoch,
    publishControlRecords: acceptCompatibilityControlPublish,
    readControlRecords: readControls,
    publishProjection,
  });
}

module.exports = { createAuthorityCloudControlService, controlError };
