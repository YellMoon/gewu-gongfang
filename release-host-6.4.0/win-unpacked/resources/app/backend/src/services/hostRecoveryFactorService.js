const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const KDF_PARAMS = Object.freeze({ name: 'scrypt', version: 1, N: 16384, r: 8, p: 1, keyLength: 32 });
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function factorError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function required(value, code) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 256) throw factorError(code);
  return normalized;
}

function generation(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw factorError('PRIMARY_HOST_GENERATION_INVALID');
  }
  return normalized;
}

function derive(raw, saltHex, params = KDF_PARAMS) {
  const salt = Buffer.from(String(saltHex || ''), 'hex');
  if (salt.length < 16 || params.name !== 'scrypt' || Number(params.version) !== 1) {
    throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_INVALID');
  }
  return crypto.scryptSync(String(raw || ''), salt, Number(params.keyLength), {
    N: Number(params.N),
    r: Number(params.r),
    p: Number(params.p),
    maxmem: SCRYPT_MAXMEM,
  });
}

function present(row) {
  return Object.freeze({
    id: row.id,
    epochId: row.epoch_id,
    userId: row.user_id,
    deviceId: row.device_id,
    generation: Number(row.generation),
    status: row.status,
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usedAt: row.used_at || null,
    usedByDeviceId: row.used_by_device_id || null,
  });
}

function createHostRecoveryFactorService({
  db,
  now = () => new Date(),
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_DB_REQUIRED');

  function currentIso() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw factorError('PRIMARY_HOST_CLOCK_INVALID');
    return date.toISOString();
  }

  function prepare(input = {}) {
    const epochId = required(input.epochId, 'PRIMARY_HOST_EPOCH_REQUIRED');
    const userId = required(input.userId, 'PRIMARY_HOST_OWNER_REQUIRED');
    const deviceId = required(input.deviceId, 'PRIMARY_HOST_DEVICE_REQUIRED');
    const nextGeneration = generation(input.generation);
    const factorId = required(uuid(), 'PRIMARY_HOST_RECOVERY_FACTOR_ID_INVALID');
    const recoveryCode = Buffer.from(randomBytes(32)).toString('base64url');
    if (recoveryCode.length < 32) throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_GENERATION_FAILED');
    const saltHex = Buffer.from(randomBytes(16)).toString('hex');
    const hashHex = derive(recoveryCode, saltHex).toString('hex');
    const timestamp = currentIso();
    return Object.freeze({
      row: Object.freeze({
        id: factorId,
        epochId,
        userId,
        deviceId,
        generation: nextGeneration,
        factorHash: hashHex,
        factorSalt: saltHex,
        kdfParamsJson: JSON.stringify(KDF_PARAMS),
        createdAt: timestamp,
      }),
      recoveryPackage: Object.freeze({
        factorId,
        recoveryCode,
        epochId,
        generation: nextGeneration,
        deviceId,
        createdAt: timestamp,
      }),
    });
  }

  function storePrepared(prepared) {
    const row = prepared?.row;
    if (!row?.id || !prepared?.recoveryPackage?.recoveryCode) {
      throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_PREPARED_INVALID');
    }
    db.prepare(`INSERT INTO host_recovery_factors
      (id, epoch_id, user_id, device_id, generation, factor_hash, factor_salt,
       kdf_params_json, status, row_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
      .run(row.id, row.epochId, row.userId, row.deviceId, row.generation,
        row.factorHash, row.factorSalt, row.kdfParamsJson, row.createdAt, row.createdAt);
    return present(db.prepare('SELECT * FROM host_recovery_factors WHERE id=?').get(row.id));
  }

  function assertUnused(input = {}) {
    const factorId = required(input.factorId, 'PRIMARY_HOST_RECOVERY_FACTOR_REQUIRED');
    const userId = required(input.userId, 'PRIMARY_HOST_OWNER_REQUIRED');
    const row = db.prepare('SELECT * FROM host_recovery_factors WHERE id=?').get(factorId);
    if (!row) throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_INVALID');
    if (row.user_id !== userId) throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_OWNER_MISMATCH');
    if (row.status === 'used') throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_USED');
    if (row.status !== 'active') throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_REVOKED');
    let params;
    try {
      params = JSON.parse(row.kdf_params_json);
    } catch (_error) {
      throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_INVALID');
    }
    const actual = derive(input.recoveryCode, row.factor_salt, params);
    const expected = Buffer.from(String(row.factor_hash || ''), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_INVALID');
    }
    return Object.freeze({ ...present(row), _rowVersion: Number(row.row_version) });
  }

  function consumeVerified({ factor, usedByDeviceId } = {}) {
    const factorId = required(factor?.id, 'PRIMARY_HOST_RECOVERY_FACTOR_REQUIRED');
    const deviceId = required(usedByDeviceId, 'PRIMARY_HOST_DEVICE_REQUIRED');
    const rowVersion = Number(factor?._rowVersion ?? factor?.rowVersion);
    if (!Number.isSafeInteger(rowVersion) || rowVersion < 1) {
      throw factorError('PRIMARY_HOST_RECOVERY_FACTOR_VERSION_INVALID');
    }
    const timestamp = currentIso();
    const result = db.prepare(`UPDATE host_recovery_factors
      SET status='used', used_at=?, used_by_device_id=?, row_version=row_version+1, updated_at=?
      WHERE id=? AND status='active' AND row_version=?`)
      .run(timestamp, deviceId, timestamp, factorId, rowVersion);
    if (result.changes !== 1) {
      const current = db.prepare('SELECT status FROM host_recovery_factors WHERE id=?').get(factorId);
      throw factorError(current?.status === 'used'
        ? 'PRIMARY_HOST_RECOVERY_FACTOR_USED'
        : 'PRIMARY_HOST_RECOVERY_FACTOR_VERSION_INVALID');
    }
    return present(db.prepare('SELECT * FROM host_recovery_factors WHERE id=?').get(factorId));
  }

  function revokeActiveForUser({ userId, exceptFactorId = null } = {}) {
    const ownerId = required(userId, 'PRIMARY_HOST_OWNER_REQUIRED');
    const timestamp = currentIso();
    const result = exceptFactorId
      ? db.prepare(`UPDATE host_recovery_factors
          SET status='revoked', revoked_at=?, row_version=row_version+1, updated_at=?
          WHERE user_id=? AND status='active' AND id<>?`)
        .run(timestamp, timestamp, ownerId, String(exceptFactorId))
      : db.prepare(`UPDATE host_recovery_factors
          SET status='revoked', revoked_at=?, row_version=row_version+1, updated_at=?
          WHERE user_id=? AND status='active'`)
        .run(timestamp, timestamp, ownerId);
    return result.changes;
  }

  return Object.freeze({
    assertUnused,
    consumeVerified,
    prepare,
    revokeActiveForUser,
    storePrepared,
  });
}

module.exports = {
  KDF_PARAMS,
  createHostRecoveryFactorService,
};
