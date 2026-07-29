const crypto = require('crypto');
const { stableJson } = require('../../../shared/authorityProtocol');

function activationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function activationReceiptSigningPayload({ activationId, packageHash } = {}) {
  const id = String(activationId || '').trim();
  const hash = String(packageHash || '').trim();
  if (!id || !hash) throw activationError('DEVICE_ACTIVATION_RECEIPT_PAYLOAD_INVALID');
  return JSON.stringify(['gewu-device-activation-v1', id, hash]);
}

function createDeviceActivationService({
  db,
  now = () => new Date().toISOString(),
  createId = () => crypto.randomUUID(),
  activationTtlMs = 10 * 60 * 1000,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw activationError('DEVICE_ACTIVATION_DATABASE_REQUIRED');
  }

  const findActivation = db.prepare('SELECT * FROM desktop_device_activations WHERE id=?');
  const findByChallenge = db.prepare('SELECT * FROM desktop_device_activations WHERE challenge_id=?');
  const findAuthorization = db.prepare('SELECT * FROM desktop_device_authorizations WHERE id=?');
  const hasProjectionVersions = Boolean(db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='authority_projection_versions'`).get());

  function timestamp() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw activationError('DEVICE_ACTIVATION_CLOCK_INVALID');
    return date.toISOString();
  }

  function present(row, replayed = false) {
    return Object.freeze({
      replayed,
      activation: Object.freeze({
        id: row.id,
        challengeId: row.challenge_id,
        authorizationId: row.authorization_id,
        packageHash: row.package_hash,
        status: row.status,
        expiresAt: row.expires_at,
      }),
      activationPackage: JSON.parse(row.package_json),
    });
  }

  const exchange = db.transaction(function exchange(input = {}) {
    const challengeId = String(input.challengeId || '').trim();
    const authorizationId = String(input.authorizationId || '').trim();
    if (!challengeId || !authorizationId || !input.activationPackage || typeof input.activationPackage !== 'object') {
      throw activationError('DEVICE_ACTIVATION_INPUT_INVALID');
    }
    const existing = findByChallenge.get(challengeId);
    if (existing) {
      if (existing.authorization_id !== authorizationId) throw activationError('DEVICE_ACTIVATION_CHALLENGE_CONFLICT');
      if (existing.status !== 'activation_pending') throw activationError('DEVICE_ACTIVATION_ALREADY_FINALIZED');
      return present(existing, true);
    }
    const authorization = findAuthorization.get(authorizationId);
    if (!authorization || authorization.status !== 'pending') {
      throw activationError('DEVICE_ACTIVATION_AUTHORIZATION_INVALID');
    }
    const createdAt = timestamp();
    const activationPackage = stableJson(input.activationPackage);
    const row = {
      id: createId(),
      challengeId,
      authorizationId,
      packageHash: digest(activationPackage),
      packageJson: activationPackage,
      expiresAt: new Date(Date.parse(createdAt) + activationTtlMs).toISOString(),
      createdAt,
    };
    db.prepare(`INSERT INTO desktop_device_activations
      (id,challenge_id,authorization_id,package_hash,package_json,status,expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,'activation_pending',?,?,?)`)
      .run(row.id, row.challengeId, row.authorizationId, row.packageHash, row.packageJson,
        row.expiresAt, row.createdAt, row.createdAt);
    return present(findActivation.get(row.id));
  });

  const finalize = db.transaction(function finalize(input = {}) {
    const activationId = String(input.activationId || '').trim();
    const signature = String(input.signature || '').trim();
    if (!activationId || !signature) throw activationError('DEVICE_ACTIVATION_SIGNATURE_REQUIRED');
    const activation = findActivation.get(activationId);
    if (!activation) throw activationError('DEVICE_ACTIVATION_NOT_FOUND');
    const authorization = findAuthorization.get(activation.authorization_id);
    if (!authorization) throw activationError('DEVICE_ACTIVATION_AUTHORIZATION_INVALID');
    let signatureValid = false;
    try {
      const signatureBuffer = Buffer.from(signature, 'base64');
      signatureValid = signatureBuffer.length === 64 && crypto.verify(
        null,
        Buffer.from(activationReceiptSigningPayload({
          activationId: activation.id,
          packageHash: activation.package_hash,
        }), 'utf8'),
        crypto.createPublicKey(authorization.public_key),
        signatureBuffer
      );
    } catch (_error) {
      signatureValid = false;
    }
    if (!signatureValid) throw activationError('DEVICE_ACTIVATION_SIGNATURE_INVALID');
    const receiptHash = digest(signature);
    if (activation.status === 'active') {
      if (activation.receipt_hash !== receiptHash) throw activationError('DEVICE_ACTIVATION_RECEIPT_CONFLICT');
      return present(activation, true);
    }
    if (activation.status !== 'activation_pending') throw activationError('DEVICE_ACTIVATION_STATE_INVALID');
    if (Date.parse(activation.expires_at) <= Date.parse(timestamp())) {
      db.prepare(`UPDATE desktop_device_activations SET status='expired', updated_at=?
        WHERE id=? AND status='activation_pending'`).run(timestamp(), activation.id);
      throw activationError('DEVICE_ACTIVATION_EXPIRED');
    }
    if (authorization.status !== 'pending') throw activationError('DEVICE_ACTIVATION_AUTHORIZATION_INVALID');
    const currentTime = timestamp();
    const activationPackage = JSON.parse(activation.package_json);
    const canonicalGrant = activationPackage?.grant;
    const canonicalLease = activationPackage?.lease;
    const hasCanonicalControl = canonicalGrant && canonicalLease
      && activationPackage.authorityId && activationPackage.hostGeneration;
    if (hasCanonicalControl) {
      const userId = String(activationPackage.userId || '').trim();
      const deviceId = String(activationPackage.deviceId || '').trim();
      const grantId = String(canonicalGrant.id || '').trim();
      const grantVersion = Number(canonicalGrant.version);
      const leaseId = String(canonicalLease.id || '').trim();
      const activeRole = String(canonicalLease.activeRole || '').trim();
      const issuedAt = String(canonicalLease.issuedAt || '').trim();
      const expiresAt = String(canonicalLease.expiresAt || '').trim();
      if (!userId || userId !== authorization.user_id || !deviceId || deviceId !== authorization.device_id
        || !grantId || !Number.isSafeInteger(grantVersion) || grantVersion < 1 || !leaseId || !activeRole
        || !Number.isFinite(Date.parse(issuedAt)) || Date.parse(expiresAt) <= Date.parse(currentTime)) {
        throw activationError('DEVICE_ACTIVATION_CONTROL_PACKAGE_INVALID');
      }
      db.prepare(`INSERT INTO device_grants
        (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,
         approved_by,created_at,updated_at,revoked_at)
        VALUES(?,?,?,?,?,?,'active',?,?,?,?,NULL)`)
        .run(
          grantId,
          String(activationPackage.authorityId),
          deviceId,
          userId,
          authorization.public_key,
          Number(activationPackage.hostGeneration),
          grantVersion,
          activationPackage.approvedBy ? String(activationPackage.approvedBy) : null,
          currentTime,
          currentTime,
        );
      db.prepare(`INSERT INTO device_leases
        (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,
         issued_at,expires_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,'active',?,?,NULL)`)
        .run(
          leaseId,
          grantId,
          String(activationPackage.authorityId),
          deviceId,
          userId,
          activeRole,
          grantVersion,
          new Date(issuedAt).toISOString(),
          new Date(expiresAt).toISOString(),
        );
      db.prepare(`INSERT INTO authority_role_bindings
        (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,
         granted_by,created_at,updated_at,revoked_at)
        VALUES(?,?,?,?,NULL,NULL,'active',?,?,?, ?,NULL)
        ON CONFLICT(authority_id,user_id,role) WHERE status='active' DO UPDATE SET
          grant_version=excluded.grant_version,updated_at=excluded.updated_at,revoked_at=NULL`)
        .run(
          `device-activation:${grantId}:${activeRole}`,
          String(activationPackage.authorityId),
          userId,
          activeRole,
          grantVersion,
          activationPackage.approvedBy ? String(activationPackage.approvedBy) : null,
          currentTime,
          currentTime,
        );
      const hostEpochId = String(activationPackage.hostEpochId || '').trim();
      if (hasProjectionVersions && hostEpochId) {
        db.prepare(`INSERT INTO authority_projection_versions
          (authority_id,host_epoch_id,version,updated_at) VALUES(?,?,1,?)
          ON CONFLICT(authority_id,host_epoch_id) DO UPDATE SET
            version=authority_projection_versions.version+1,
            updated_at=excluded.updated_at`)
          .run(String(activationPackage.authorityId), hostEpochId, currentTime);
      }
    }
    const authorizationUpdate = db.prepare(`UPDATE desktop_device_authorizations
      SET status='active', row_version=row_version+1, updated_at=?
      WHERE id=? AND status='pending'`).run(currentTime, authorization.id);
    if (authorizationUpdate.changes !== 1) throw activationError('DEVICE_ACTIVATION_AUTHORIZATION_STALE');
    const activationUpdate = db.prepare(`UPDATE desktop_device_activations
      SET status='active', finalized_at=?, receipt_hash=?, updated_at=?
      WHERE id=? AND status='activation_pending'`).run(currentTime, receiptHash, currentTime, activation.id);
    if (activationUpdate.changes !== 1) throw activationError('DEVICE_ACTIVATION_STATE_STALE');
    return present(findActivation.get(activation.id));
  });

  function resume(input = {}) {
    if (input.signature) return finalize(input);
    const activation = findActivation.get(String(input.activationId || '').trim());
    if (!activation) throw activationError('DEVICE_ACTIVATION_NOT_FOUND');
    if (activation.status !== 'activation_pending') throw activationError('DEVICE_ACTIVATION_RECEIPT_REQUIRED');
    return present(activation, true);
  }

  return Object.freeze({ exchange, finalize, resume });
}

module.exports = {
  activationError,
  activationReceiptSigningPayload,
  createDeviceActivationService,
  digest,
};
