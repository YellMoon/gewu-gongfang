function projectionError(code, statusCode = 409) {
  return Object.assign(new Error(code), { code, statusCode });
}

function text(value, code, maxLength = 4096) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw projectionError(code, 400);
  return normalized;
}

function timestamp(value, code) {
  const normalized = text(value, code, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw projectionError(code, 400);
  return normalized;
}

function integer(value, code) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw projectionError(code, 400);
  return normalized;
}

function projectionInput(input = {}) {
  const authorization = input.authorization;
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 400);
  }
  if (authorization.status !== 'active') {
    throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_STATUS_INVALID', 400);
  }
  const fingerprint = text(authorization.keyFingerprint, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 400);
  }
  const source = text(authorization.authorizationSource, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 64);
  if (source !== 'wechat_phone') {
    throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_SOURCE_INVALID', 400);
  }
  return Object.freeze({
    id: text(authorization.id, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 128),
    deviceId: text(authorization.deviceId, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 128),
    deviceName: text(authorization.deviceName, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 128),
    deviceKind: text(authorization.deviceKind, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 32),
    userId: text(authorization.userId, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 128),
    publicKey: text(authorization.publicKey, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID', 8192),
    keyFingerprint: fingerprint,
    credentialVersion: integer(authorization.credentialVersion, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID'),
    authorizationSource: source,
    lastPhoneVerifiedAt: timestamp(authorization.lastPhoneVerifiedAt, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID'),
    phoneReverifyDueAt: timestamp(authorization.phoneReverifyDueAt, 'DESKTOP_AUTHORIZATION_PROJECTION_INVALID'),
  });
}

function activeUser(user) {
  return Boolean(user)
    && user.deleted !== 1
    && user.status !== 0
    && user.login_enabled !== 0
    && user.review_status === 'approved';
}

function createDesktopAuthorizationProjectionService({ db, now = () => new Date() } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_DB_REQUIRED', 500);
  }
  const findUser = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0');
  const findById = db.prepare('SELECT * FROM desktop_device_authorizations WHERE id=?');
  const findByDevice = db.prepare('SELECT * FROM desktop_device_authorizations WHERE device_id=?');
  const insert = db.prepare(`INSERT INTO desktop_device_authorizations
    (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
     status, source_challenge_id, authorization_source, last_phone_verified_at, phone_reverify_due_at,
     credential_version, row_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 1, ?, ?)`);
  const update = db.prepare(`UPDATE desktop_device_authorizations
    SET device_name=?, device_kind=?, public_key=?, key_fingerprint=?, authorization_source=?,
        last_phone_verified_at=?, phone_reverify_due_at=?, credential_version=?,
        row_version=row_version+1, updated_at=?
    WHERE id=? AND row_version=?`);

  function currentTime() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_CLOCK_INVALID', 500);
    return date.toISOString();
  }

  const apply = db.transaction(function apply(input = {}) {
    const next = projectionInput(input);
    const user = findUser.get(next.userId);
    if (!activeUser(user)) throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_USER_NOT_FOUND', 403);
    const byId = findById.get(next.id);
    const byDevice = findByDevice.get(next.deviceId);
    if (byDevice && byDevice.id !== next.id) {
      throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_DEVICE_CONFLICT', 409);
    }
    const time = currentTime();
    if (!byId) {
      insert.run(
        next.id, next.deviceId, next.deviceName, next.deviceKind, next.userId, next.publicKey,
        next.keyFingerprint, `cloud-projection:${next.id}`, next.authorizationSource,
        next.lastPhoneVerifiedAt, next.phoneReverifyDueAt, next.credentialVersion, time, time
      );
      return Object.freeze({ authorizationId: next.id, deviceId: next.deviceId, userId: next.userId, status: 'active', changed: true });
    }
    if (byId.device_id !== next.deviceId || byId.user_id !== next.userId || byId.status !== 'active') {
      throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_IMMUTABLE_MISMATCH', 409);
    }
    if (Number(byId.credential_version) > next.credentialVersion) {
      throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_VERSION_STALE', 409);
    }
    const unchanged = byId.device_name === next.deviceName
      && byId.device_kind === next.deviceKind
      && byId.public_key === next.publicKey
      && byId.key_fingerprint === next.keyFingerprint
      && byId.authorization_source === next.authorizationSource
      && byId.last_phone_verified_at === next.lastPhoneVerifiedAt
      && byId.phone_reverify_due_at === next.phoneReverifyDueAt
      && Number(byId.credential_version) === next.credentialVersion;
    if (unchanged) {
      return Object.freeze({ authorizationId: next.id, deviceId: next.deviceId, userId: next.userId, status: 'active', changed: false });
    }
    const outcome = update.run(
      next.deviceName, next.deviceKind, next.publicKey, next.keyFingerprint, next.authorizationSource,
      next.lastPhoneVerifiedAt, next.phoneReverifyDueAt, next.credentialVersion, time, next.id, Number(byId.row_version)
    );
    if (outcome.changes !== 1) throw projectionError('DESKTOP_AUTHORIZATION_PROJECTION_VERSION_STALE', 409);
    return Object.freeze({ authorizationId: next.id, deviceId: next.deviceId, userId: next.userId, status: 'active', changed: true });
  });

  return Object.freeze({ apply });
}

module.exports = { createDesktopAuthorizationProjectionService };
