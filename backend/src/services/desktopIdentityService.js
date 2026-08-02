const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone } = require('./authorizationPolicy');
const { resolveActiveAuthorityRoleContext } = require('./authorityRoleGrantAdapter');

const ACTIVE_CHALLENGE_STATUSES = Object.freeze([
  'pending_phone',
  'identity_verified_pending_approval',
  'approved_pending_exchange',
]);
const START_KEYS = new Set(['deviceId', 'deviceName', 'deviceKind', 'publicKey', 'keyFingerprint', 'purpose']);
const CONFIRM_KEYS = new Set(['challengeId', 'identity', 'loginEventId', 'expectedRowVersion']);
const VERIFY_SECRET_KEYS = new Set(['challengeId', 'challengeSecret']);
const APPROVE_KEYS = new Set(['challengeId', 'actorContext', 'expectedRowVersion']);
const REJECT_KEYS = new Set(['challengeId', 'actorContext', 'expectedRowVersion', 'reason']);
const EXCHANGE_KEYS = new Set([
  'challengeId',
  'challengeSecret',
  'signature',
  'expectedRowVersion',
]);
const PUBLIC_PURPOSES = new Set(['register', 'password_reset']);
const DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const PHONE_REVERIFY_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_SUPER_ADMIN_MS = 15 * 60 * 1000;
const ROLE_ORDER = Object.freeze(['super_admin', 'admin', 'teacher', 'student']);

function serviceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertAllowedKeys(input, allowedKeys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw serviceError('DESKTOP_IDENTITY_INPUT_INVALID');
  }
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw serviceError('DESKTOP_IDENTITY_INPUT_FORBIDDEN');
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fingerprintPublicKey(publicKey) {
  let key;
  try {
    key = crypto.createPublicKey(publicKey);
  } catch (_error) {
    throw serviceError('DESKTOP_DEVICE_PUBLIC_KEY_INVALID');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw serviceError('DESKTOP_DEVICE_PUBLIC_KEY_INVALID');
  }
  return sha256(key.export({ type: 'spki', format: 'der' }));
}

function normalizePublicKey(publicKey) {
  let key;
  try {
    key = crypto.createPublicKey(publicKey);
  } catch (_error) {
    throw serviceError('DESKTOP_DEVICE_PUBLIC_KEY_INVALID');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw serviceError('DESKTOP_DEVICE_PUBLIC_KEY_INVALID');
  }
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

function safeHashEqual(rawSecret, expectedHash) {
  const actual = Buffer.from(sha256(String(rawSecret || '')), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === 32
    && expected.length === 32
    && crypto.timingSafeEqual(actual, expected);
}

function desktopExchangeSigningPayload({ challengeId, deviceId, rowVersion, challengeSecret } = {}) {
  const normalizedChallengeId = String(challengeId || '').trim();
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedChallengeId || !normalizedDeviceId || !Number.isSafeInteger(Number(rowVersion))) {
    throw serviceError('DESKTOP_EXCHANGE_PAYLOAD_INVALID');
  }
  return [
    'gewu-desktop-exchange-v1',
    normalizedChallengeId,
    normalizedDeviceId,
    String(Number(rowVersion)),
    sha256(String(challengeSecret || '')),
  ].join('\n');
}

function isApprovedIdentity(user) {
  return Boolean(user)
    && user.deleted !== 1
    && user.deleted !== true
    && user.status !== 0
    && user.status !== false
    && user.status !== 'inactive'
    && user.status !== 'disabled'
    && user.login_enabled !== 0
    && user.login_enabled !== false
    && user.review_status === 'approved';
}

function presentChallenge(row) {
  return Object.freeze({
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceKind: row.device_kind,
    keyFingerprint: row.key_fingerprint,
    purpose: row.purpose,
    shortCode: row.short_code,
    status: row.status,
    claimedUserId: row.claimed_user_id || null,
    authorizationId: row.authorization_id || null,
    phoneVerifiedAt: row.phone_verified_at || null,
    rowVersion: Number(row.row_version),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function presentPublicChallenge(row) {
  return Object.freeze({
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceKind: row.device_kind,
    keyFingerprint: row.key_fingerprint,
    purpose: row.purpose,
    shortCode: row.short_code,
    status: row.status,
    rowVersion: Number(row.row_version),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function presentMiniappChallenge(row) {
  return Object.freeze({
    id: row.id,
    deviceName: row.device_name,
    keyFingerprintSummary: `${String(row.key_fingerprint || '').slice(0, 8)}…${String(row.key_fingerprint || '').slice(-4)}`,
    purpose: row.purpose,
    status: row.status,
    rowVersion: Number(row.row_version),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 7) return '';
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

function presentAuthorization(row) {
  return Object.freeze({
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceKind: row.device_kind,
    userId: row.user_id,
    keyFingerprint: row.key_fingerprint,
    status: row.status,
    approvedByUserId: row.approved_by_user_id || null,
    approvedByDeviceId: row.approved_by_device_id || null,
    approvedAt: row.approved_at || null,
    lastPhoneVerifiedAt: row.last_phone_verified_at,
    phoneReverifyDueAt: row.phone_reverify_due_at,
    credentialVersion: Number(row.credential_version),
    lastSeenAt: row.last_seen_at || null,
    rowVersion: Number(row.row_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at || null,
    retiredAt: row.retired_at || null,
    replacedByDeviceId: row.replaced_by_device_id || null,
  });
}

function createDesktopIdentityService({
  db,
  now = function () { return new Date(); },
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
  randomInt = crypto.randomInt,
  challengeTtlMs = DEFAULT_CHALLENGE_TTL_MS,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw serviceError('DESKTOP_IDENTITY_DB_REQUIRED');
  }
  if (!Number.isSafeInteger(challengeTtlMs) || challengeTtlMs < 1000 || challengeTtlMs > DEFAULT_CHALLENGE_TTL_MS) {
    throw serviceError('DESKTOP_CHALLENGE_TTL_INVALID');
  }

  const findChallenge = db.prepare('SELECT * FROM desktop_identity_challenges WHERE id=?');
  const findUser = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0');
  const findLoginEvent = db.prepare('SELECT * FROM miniapp_login_events WHERE id=?');
  const findAuthorizationByDevice = db.prepare(
    'SELECT * FROM desktop_device_authorizations WHERE device_id=?'
  );
  const findAuthorizationByFingerprint = db.prepare(
    'SELECT * FROM desktop_device_authorizations WHERE key_fingerprint=?'
  );
  const findUsedLoginEvent = db.prepare(
    'SELECT id FROM desktop_identity_challenges WHERE verified_login_event_id=? AND id!=?'
  );
  const findAuthorizationById = db.prepare(
    'SELECT * FROM desktop_device_authorizations WHERE id=?'
  );
  const findActivePrimaryHostEpoch = db.prepare(`SELECT id FROM primary_host_epochs
    WHERE status='active' AND device_id=? AND user_id=? AND authorization_id=?
    LIMIT 1`);
  const countActivePrimaryHostAuthorizations = db.prepare(`SELECT COUNT(*) count
    FROM desktop_device_authorizations
    WHERE device_kind='primary-host' AND status='active'`);
  const insertAudit = db.prepare(`INSERT INTO authorization_audit_log
    (id, actor_user_id, target_user_id, action, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  function timestamp() {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw serviceError('DESKTOP_IDENTITY_CLOCK_INVALID');
    return date.toISOString();
  }

  function readChallenge(challengeId) {
    const row = findChallenge.get(String(challengeId || '').trim());
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    return presentChallenge(row);
  }

  function readPublicChallenge(challengeId) {
    const row = findChallenge.get(String(challengeId || '').trim());
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const currentTime = timestamp();
    expireChallengeIfNeeded(row, currentTime);
    return presentPublicChallenge(findChallenge.get(row.id));
  }

  function readMiniappChallenge(challengeId) {
    const row = findChallenge.get(String(challengeId || '').trim());
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const currentTime = timestamp();
    expireChallengeIfNeeded(row, currentTime);
    return presentMiniappChallenge(findChallenge.get(row.id));
  }

  function eligibleRolesForUser(userId) {
    try {
      const context = resolveActiveAuthorityRoleContext(db, { userId });
      const roleSet = new Set(context.grants.map(function (grant) { return grant.role; }));
      const formalRoles = ROLE_ORDER.filter(function (role) { return roleSet.has(role); });
      return Object.freeze(formalRoles.length > 0 ? formalRoles : ['visitor']);
    } catch (_error) {
      return Object.freeze([]);
    }
  }

  function presentClaimant(userId) {
    const user = findUser.get(String(userId || '').trim());
    if (!user) throw serviceError('DESKTOP_IDENTITY_NOT_ELIGIBLE');
    return Object.freeze({
      id: user.id,
      name: user.name || user.nickname || '',
      maskedPhone: maskPhone(user.phone_normalized || user.phone),
      eligibleRoles: eligibleRolesForUser(user.id),
    });
  }

  function appendAudit({ actorUserId = null, targetUserId = null, action, before, after, at }) {
    insertAudit.run(
      uuid(),
      actorUserId,
      targetUserId,
      action,
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after),
      at
    );
  }

  function startChallenge(input = {}, options = {}) {
    assertAllowedKeys(input, START_KEYS);
    const deviceId = String(input.deviceId || '').trim();
    let deviceName = String(input.deviceName || '').trim();
    const deviceKind = String(input.deviceKind || 'desktop-client').trim();
    const purpose = String(input.purpose || 'register').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)) {
      throw serviceError('DESKTOP_DEVICE_ID_INVALID');
    }
    if (!deviceName || deviceName.length > 128) throw serviceError('DESKTOP_DEVICE_NAME_INVALID');
    if (!['desktop-client', 'primary-host'].includes(deviceKind)) throw serviceError('DESKTOP_DEVICE_KIND_INVALID');
    if (!PUBLIC_PURPOSES.has(purpose)) throw serviceError('DESKTOP_CHALLENGE_PURPOSE_INVALID');
    if (String(input.publicKey || '').length > 4096) throw serviceError('DESKTOP_DEVICE_PUBLIC_KEY_INVALID');

    const publicKey = normalizePublicKey(input.publicKey);
    const actualFingerprint = fingerprintPublicKey(publicKey);
    const providedFingerprint = String(input.keyFingerprint || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(providedFingerprint) || providedFingerprint !== actualFingerprint) {
      throw serviceError('DESKTOP_DEVICE_FINGERPRINT_MISMATCH');
    }
    // Repair records created by versions that expired the challenge but left its
    // provisional authorization pending. A pending row from an expired request
    // must never permanently prevent the same computer from starting over.
    const repairTime = timestamp();
    db.prepare(`UPDATE desktop_device_authorizations
      SET status='revoked', revoked_at=COALESCE(revoked_at, ?),
          row_version=row_version+1, updated_at=?
      WHERE status='pending' AND (device_id=? OR key_fingerprint=?)
        AND EXISTS (SELECT 1 FROM desktop_identity_challenges challenge
          WHERE challenge.id=desktop_device_authorizations.source_challenge_id
            AND challenge.status='expired')`)
      .run(repairTime, repairTime, deviceId, actualFingerprint);
    const existingDeviceAuthorization = findAuthorizationByDevice.get(deviceId);
    if (purpose === 'password_reset') {
      if (!existingDeviceAuthorization || existingDeviceAuthorization.status !== 'active') {
        throw serviceError('DESKTOP_PASSWORD_RESET_DEVICE_NOT_ACTIVE');
      }
      if (existingDeviceAuthorization.device_kind !== deviceKind) {
        throw serviceError('DESKTOP_PASSWORD_RESET_DEVICE_KIND_INVALID');
      }
      deviceName = existingDeviceAuthorization.device_name;
      if (existingDeviceAuthorization.key_fingerprint === actualFingerprint) {
        throw serviceError('DESKTOP_PASSWORD_RESET_KEY_UNCHANGED');
      }
    } else if (existingDeviceAuthorization && existingDeviceAuthorization.status !== 'revoked') {
      throw serviceError('DESKTOP_DEVICE_ALREADY_REGISTERED');
    }
    const existingFingerprintAuthorization = findAuthorizationByFingerprint.get(actualFingerprint);
    if (existingFingerprintAuthorization && existingFingerprintAuthorization.status !== 'revoked') {
      throw serviceError('DESKTOP_DEVICE_KEY_ALREADY_REGISTERED');
    }
    const activeChallenge = db.prepare(`SELECT id FROM desktop_identity_challenges
      WHERE device_id=? AND status IN ('pending_phone','identity_verified_pending_approval','approved_pending_exchange')`)
      .get(deviceId);
    if (activeChallenge) throw serviceError('DESKTOP_DEVICE_CHALLENGE_EXISTS');
    const activeKeyChallenge = db.prepare(`SELECT id FROM desktop_identity_challenges
      WHERE key_fingerprint=?
        AND status IN ('pending_phone','identity_verified_pending_approval','approved_pending_exchange')`)
      .get(actualFingerprint);
    if (activeKeyChallenge) throw serviceError('DESKTOP_DEVICE_KEY_CHALLENGE_EXISTS');

    const createdAt = timestamp();
    const expiresAt = new Date(Date.parse(createdAt) + challengeTtlMs).toISOString();
    const secretBytes = randomBytes(32);
    const secretBuffer = Buffer.isBuffer(secretBytes) ? secretBytes : Buffer.from(secretBytes);
    if (secretBuffer.length < 32) throw serviceError('DESKTOP_CHALLENGE_RANDOM_INVALID');
    const challengeSecret = secretBuffer.toString('base64url');
    const challengeTokenHash = sha256(challengeSecret);
    const challengeId = String(options.challengeId || uuid()).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(challengeId)) {
      throw serviceError('DESKTOP_CHALLENGE_ID_INVALID');
    }
    const insert = db.prepare(`INSERT INTO desktop_identity_challenges
      (id, device_id, device_name, device_kind, public_key, key_fingerprint, purpose,
       challenge_token_hash, short_code, status, row_version, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_phone', 1, ?, ?, ?)`);

    let shortCode = null;
    let lastConstraint = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = Number(randomInt(100000, 1000000));
      if (!Number.isSafeInteger(value) || value < 100000 || value > 999999) {
        throw serviceError('DESKTOP_SHORT_CODE_RANDOM_INVALID');
      }
      shortCode = String(value);
      try {
        insert.run(
          challengeId,
          deviceId,
          deviceName,
          deviceKind,
          publicKey,
          actualFingerprint,
          purpose,
          challengeTokenHash,
          shortCode,
          expiresAt,
          createdAt,
          createdAt
        );
        lastConstraint = null;
        break;
      } catch (error) {
        if (!String(error.code || '').includes('SQLITE_CONSTRAINT')) throw error;
        lastConstraint = error;
      }
    }
    if (lastConstraint) throw serviceError('DESKTOP_SHORT_CODE_GENERATION_FAILED');
    return Object.freeze({
      id: challengeId,
      challengeSecret,
      shortCode,
      status: 'pending_phone',
      rowVersion: 1,
      expiresAt,
    });
  }

  function expireChallengeIfNeeded(row, currentTime) {
    if (!ACTIVE_CHALLENGE_STATUSES.includes(row.status)) return false;
    if (Date.parse(row.expires_at) > Date.parse(currentTime)) return false;
    const expired = db.prepare(`UPDATE desktop_identity_challenges
      SET status='expired', row_version=row_version+1, updated_at=?
      WHERE id=? AND row_version=? AND status IN
        ('pending_phone','identity_verified_pending_approval','approved_pending_exchange')`)
      .run(currentTime, row.id, row.row_version);
    if (expired.changes !== 1) return false;
    if (row.authorization_id) {
      db.prepare(`UPDATE desktop_device_authorizations
        SET status='revoked', revoked_at=?, row_version=row_version+1, updated_at=?
        WHERE id=? AND status='pending'`)
        .run(currentTime, currentTime, row.authorization_id);
    }
    return true;
  }

  function abandonPendingChallenge(challengeId) {
    const normalizedId = String(challengeId || '').trim();
    const row = findChallenge.get(normalizedId);
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const currentTime = timestamp();
    const updated = db.prepare(`UPDATE desktop_identity_challenges
      SET status='rejected', row_version=row_version+1, updated_at=?
      WHERE id=? AND status='pending_phone' AND claimed_user_id IS NULL`)
      .run(currentTime, normalizedId);
    if (updated.changes !== 1) throw serviceError('DESKTOP_CHALLENGE_STATE_INVALID');
    appendAudit({
      action: 'desktop_identity_registration_abandoned',
      before: { challengeId: row.id, status: row.status, rowVersion: Number(row.row_version) },
      after: { challengeId: row.id, status: 'rejected', rowVersion: Number(row.row_version) + 1 },
      at: currentTime,
    });
    return presentChallenge(findChallenge.get(normalizedId));
  }

  function verifyChallengeSecret(input = {}) {
    assertAllowedKeys(input, VERIFY_SECRET_KEYS);
    const challengeId = String(input.challengeId || '').trim();
    const row = findChallenge.get(challengeId);
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const currentTime = timestamp();
    if (expireChallengeIfNeeded(row, currentTime)) throw serviceError('DESKTOP_CHALLENGE_EXPIRED');
    if (!safeHashEqual(input.challengeSecret, row.challenge_token_hash)) {
      throw serviceError('DESKTOP_CHALLENGE_SECRET_INVALID');
    }
    return Object.freeze({ ...row });
  }

  const confirmTransaction = db.transaction(function (input) {
    const challengeId = String(input.challengeId || '').trim();
    const identityId = String(input.identity?.id || '').trim();
    const loginEventId = String(input.loginEventId || '').trim();
    if (!challengeId || !identityId || !loginEventId) {
      throw serviceError('DESKTOP_VERIFIED_IDENTITY_REQUIRED');
    }
    const row = findChallenge.get(challengeId);
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const currentTime = timestamp();
    if (expireChallengeIfNeeded(row, currentTime)) {
      return { errorCode: 'DESKTOP_CHALLENGE_EXPIRED' };
    }
    if (row.claimed_user_id && row.claimed_user_id !== identityId) {
      throw serviceError('DESKTOP_CHALLENGE_CLAIMANT_CONFLICT');
    }
    if (row.status === 'identity_verified_pending_approval'
      && row.claimed_user_id === identityId
      && row.verified_login_event_id === loginEventId
      && row.authorization_id) {
      return { row };
    }
    if (row.status !== 'pending_phone') throw serviceError('DESKTOP_CHALLENGE_STATE_INVALID');
    if (input.expectedRowVersion !== undefined
      && (!Number.isSafeInteger(input.expectedRowVersion)
        || Number(input.expectedRowVersion) !== Number(row.row_version))) {
      throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    }

    const user = findUser.get(identityId);
    const eligibleRoles = eligibleRolesForUser(identityId);
    if (!isApprovedIdentity(user) || eligibleRoles.length < 1) {
      throw serviceError('DESKTOP_IDENTITY_NOT_ELIGIBLE');
    }
    const loginEvent = findLoginEvent.get(loginEventId);
    const expectedLoginResult = eligibleRoles.length === 1 && eligibleRoles[0] === 'visitor'
      ? 'VISITOR_LOGIN_SUCCESS'
      : 'FORMAL_LOGIN_SUCCESS';
    if (!loginEvent || loginEvent.result_code !== expectedLoginResult) {
      throw serviceError('DESKTOP_VERIFIED_LOGIN_EVENT_REQUIRED');
    }
    if (loginEvent.user_id !== identityId) {
      throw serviceError('DESKTOP_VERIFIED_LOGIN_IDENTITY_MISMATCH');
    }
    const verifiedPhone = normalizePhone(loginEvent.phone_normalized);
    const userPhone = normalizePhone(user.phone_normalized || user.phone);
    if (!verifiedPhone || verifiedPhone !== userPhone) {
      throw serviceError('DESKTOP_VERIFIED_LOGIN_PHONE_MISMATCH');
    }
    const eventTime = Date.parse(loginEvent.created_at);
    const challengeTime = Date.parse(row.created_at);
    const currentTimeMs = Date.parse(currentTime);
    if (!Number.isFinite(eventTime)
      || eventTime < challengeTime
      || eventTime > currentTimeMs + 30 * 1000) {
      throw serviceError('DESKTOP_PHONE_PROOF_STALE');
    }
    if (findUsedLoginEvent.get(loginEventId, challengeId)) {
      throw serviceError('DESKTOP_PHONE_PROOF_REPLAYED');
    }
    const phoneReverifyDueAt = new Date(eventTime + PHONE_REVERIFY_MS).toISOString();
    const existingAuthorization = findAuthorizationByDevice.get(row.device_id);
    let authorizationId;
    let primaryHostSelfRecovery = false;
    if (row.purpose === 'password_reset') {
      if (!existingAuthorization || existingAuthorization.status !== 'active') {
        throw serviceError('DESKTOP_PASSWORD_RESET_DEVICE_NOT_ACTIVE');
      }
      if (existingAuthorization.user_id !== identityId) {
        throw serviceError('DESKTOP_PASSWORD_RESET_IDENTITY_MISMATCH');
      }
      authorizationId = existingAuthorization.id;
      const activePrimaryHostEpoch = findActivePrimaryHostEpoch.get(
        row.device_id,
        identityId,
        existingAuthorization.id
      );
      const soleLegacyPrimaryHost = Number(countActivePrimaryHostAuthorizations.get().count) === 1;
      primaryHostSelfRecovery = row.device_kind === 'primary-host'
        && existingAuthorization.device_kind === 'primary-host'
        && eligibleRolesForUser(identityId).includes('super_admin')
        && (Boolean(activePrimaryHostEpoch) || soleLegacyPrimaryHost);
    } else {
      if (existingAuthorization) {
        if (existingAuthorization.user_id !== identityId) {
          throw serviceError('DESKTOP_DEVICE_OWNER_CONFLICT');
        }
        if (existingAuthorization.status !== 'revoked') {
          throw serviceError('DESKTOP_DEVICE_ALREADY_REGISTERED');
        }
        const restored = db.prepare(`UPDATE desktop_device_authorizations
          SET device_name=?, device_kind=?, public_key=?, key_fingerprint=?, status='pending',
              source_challenge_id=?, approved_by_user_id=NULL, approved_by_device_id=NULL,
              approved_at=NULL, last_phone_verified_at=?, phone_reverify_due_at=?,
              credential_version=credential_version+1, row_version=row_version+1,
              revoked_at=NULL, retired_at=NULL, updated_at=?
          WHERE id=? AND status='revoked' AND row_version=?`)
          .run(
            row.device_name,
            row.device_kind,
            row.public_key,
            row.key_fingerprint,
            row.id,
            loginEvent.created_at,
            phoneReverifyDueAt,
            currentTime,
            existingAuthorization.id,
            existingAuthorization.row_version
          );
        if (restored.changes !== 1) throw serviceError('DESKTOP_AUTHORIZATION_VERSION_STALE');
        authorizationId = existingAuthorization.id;
      } else {
        authorizationId = uuid();
        db.prepare(`INSERT INTO desktop_device_authorizations
          (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
           status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
           credential_version, row_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, 1, ?, ?)`)
          .run(
            authorizationId,
            row.device_id,
            row.device_name,
            row.device_kind,
            identityId,
            row.public_key,
            row.key_fingerprint,
            row.id,
            loginEvent.created_at,
            phoneReverifyDueAt,
            currentTime,
            currentTime
          );
      }
    }
    const nextStatus = primaryHostSelfRecovery
      ? 'approved_pending_exchange'
      : 'identity_verified_pending_approval';
    const updated = db.prepare(`UPDATE desktop_identity_challenges
      SET status=?, claimed_user_id=?, verified_login_event_id=?, authorization_id=?, phone_verified_at=?,
          approved_at=CASE WHEN ?='approved_pending_exchange' THEN ? ELSE approved_at END,
          row_version=row_version+1, updated_at=?
      WHERE id=? AND status='pending_phone' AND row_version=?`)
      .run(
        nextStatus,
        identityId,
        loginEventId,
        authorizationId,
        loginEvent.created_at,
        nextStatus,
        currentTime,
        currentTime,
        row.id,
        row.row_version
      );
    if (updated.changes !== 1) throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    if (primaryHostSelfRecovery) {
      const authorizationUpdate = db.prepare(`UPDATE desktop_device_authorizations
        SET approved_by_user_id=?, approved_by_device_id=?, approved_at=?,
            row_version=row_version+1, updated_at=?
        WHERE id=? AND status='active' AND row_version=?`)
        .run(
          identityId,
          row.device_id,
          currentTime,
          currentTime,
          authorizationId,
          existingAuthorization.row_version
        );
      if (authorizationUpdate.changes !== 1) throw serviceError('DESKTOP_AUTHORIZATION_VERSION_STALE');
    }
    appendAudit({
      actorUserId: primaryHostSelfRecovery ? identityId : null,
      targetUserId: identityId,
      action: primaryHostSelfRecovery
        ? 'desktop_primary_host_password_reset_phone_approved'
        : 'desktop_identity_phone_verified',
      before: { challengeId: row.id, status: row.status, rowVersion: Number(row.row_version) },
      after: {
        challengeId: row.id,
        deviceId: row.device_id,
        status: nextStatus,
        rowVersion: Number(row.row_version) + 1,
      },
      at: currentTime,
    });
    return { row: findChallenge.get(row.id) };
  });

  function confirmVerifiedIdentity(input = {}) {
    assertAllowedKeys(input, CONFIRM_KEYS);
    let outcome;
    try {
      outcome = confirmTransaction(input);
    } catch (error) {
      if (String(error.code || '').includes('SQLITE_CONSTRAINT')
        && String(error.message || '').includes('verified_login_event_id')) {
        throw serviceError('DESKTOP_PHONE_PROOF_REPLAYED');
      }
      throw error;
    }
    if (outcome.errorCode) throw serviceError(outcome.errorCode);
    return presentChallenge(outcome.row);
  }

  function assertApprovalActor(actorContext, targetDeviceId, currentTime) {
    if (!actorContext || actorContext.activeRole !== 'super_admin') {
      throw serviceError('DESKTOP_SUPER_ADMIN_ROLE_REQUIRED');
    }
    const actorUserId = String(actorContext.userId || '').trim();
    const actorDeviceId = String(actorContext.deviceId || '').trim();
    if (!actorUserId || !actorDeviceId) throw serviceError('DESKTOP_SUPER_ADMIN_ROLE_REQUIRED');
    if (actorDeviceId === targetDeviceId) {
      throw serviceError('DESKTOP_DEVICE_SELF_APPROVAL_FORBIDDEN');
    }
    const authTime = Date.parse(actorContext.authTime || '');
    const nowMs = Date.parse(currentTime);
    if (!Number.isFinite(authTime)
      || authTime > nowMs + 30 * 1000
      || nowMs - authTime > RECENT_SUPER_ADMIN_MS) {
      throw serviceError('DESKTOP_RECENT_SUPER_ADMIN_REQUIRED');
    }
    return { actorUserId, actorDeviceId };
  }

  const approveTransaction = db.transaction(function (input) {
    const challengeId = String(input.challengeId || '').trim();
    const row = findChallenge.get(challengeId);
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const currentTime = timestamp();
    if (expireChallengeIfNeeded(row, currentTime)) {
      return { errorCode: 'DESKTOP_CHALLENGE_EXPIRED' };
    }
    if (row.status !== 'identity_verified_pending_approval') {
      throw serviceError('DESKTOP_CHALLENGE_STATE_INVALID');
    }
    if (!Number.isSafeInteger(input.expectedRowVersion)
      || Number(input.expectedRowVersion) !== Number(row.row_version)) {
      throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    }
    const actor = assertApprovalActor(input.actorContext, row.device_id, currentTime);
    const authorization = findAuthorizationById.get(row.authorization_id);
    const expectedAuthorizationStatus = row.purpose === 'password_reset' ? 'active' : 'pending';
    if (!authorization || authorization.status !== expectedAuthorizationStatus
      || authorization.user_id !== row.claimed_user_id) {
      throw serviceError('DESKTOP_AUTHORIZATION_STATE_INVALID');
    }

    const challengeUpdate = db.prepare(`UPDATE desktop_identity_challenges
      SET status='approved_pending_exchange', approved_at=?, row_version=row_version+1, updated_at=?
      WHERE id=? AND status='identity_verified_pending_approval' AND row_version=?`)
      .run(currentTime, currentTime, row.id, row.row_version);
    if (challengeUpdate.changes !== 1) throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    const authorizationUpdate = db.prepare(`UPDATE desktop_device_authorizations
      SET approved_by_user_id=?, approved_by_device_id=?, approved_at=?,
          row_version=row_version+1, updated_at=?
      WHERE id=? AND status=? AND row_version=?`)
      .run(
        actor.actorUserId,
        actor.actorDeviceId,
        currentTime,
        currentTime,
        authorization.id,
        expectedAuthorizationStatus,
        authorization.row_version
      );
    if (authorizationUpdate.changes !== 1) throw serviceError('DESKTOP_AUTHORIZATION_VERSION_STALE');
    appendAudit({
      actorUserId: actor.actorUserId,
      targetUserId: row.claimed_user_id,
      action: 'desktop_device_authorization_approved',
      before: { challengeId: row.id, status: row.status, rowVersion: Number(row.row_version) },
      after: {
        challengeId: row.id,
        deviceId: row.device_id,
        status: 'approved_pending_exchange',
        rowVersion: Number(row.row_version) + 1,
      },
      at: currentTime,
    });
    return { row: findChallenge.get(row.id) };
  });

  function approveChallenge(input = {}) {
    assertAllowedKeys(input, APPROVE_KEYS);
    const outcome = approveTransaction(input);
    if (outcome.errorCode) throw serviceError(outcome.errorCode);
    return presentChallenge(outcome.row);
  }

  const rejectTransaction = db.transaction(function (input) {
    const challengeId = String(input.challengeId || '').trim();
    const row = findChallenge.get(challengeId);
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const currentTime = timestamp();
    if (expireChallengeIfNeeded(row, currentTime)) {
      return { errorCode: 'DESKTOP_CHALLENGE_EXPIRED' };
    }
    if (row.status !== 'identity_verified_pending_approval') {
      throw serviceError('DESKTOP_CHALLENGE_STATE_INVALID');
    }
    if (!Number.isSafeInteger(input.expectedRowVersion)
      || Number(input.expectedRowVersion) !== Number(row.row_version)) {
      throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    }
    const actor = assertApprovalActor(input.actorContext, row.device_id, currentTime);
    const authorization = findAuthorizationById.get(row.authorization_id);
    const challengeUpdate = db.prepare(`UPDATE desktop_identity_challenges
      SET status='rejected', rejected_at=?, row_version=row_version+1, updated_at=?
      WHERE id=? AND status='identity_verified_pending_approval' AND row_version=?`)
      .run(currentTime, currentTime, row.id, row.row_version);
    if (challengeUpdate.changes !== 1) throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    if (authorization && row.purpose !== 'password_reset') {
      db.prepare(`UPDATE desktop_device_authorizations
        SET status='revoked', revoked_at=?, row_version=row_version+1, updated_at=?
        WHERE id=? AND status='pending'`)
        .run(currentTime, currentTime, authorization.id);
    }
    appendAudit({
      actorUserId: actor.actorUserId,
      targetUserId: row.claimed_user_id,
      action: 'desktop_device_authorization_rejected',
      before: { challengeId: row.id, status: row.status },
      after: {
        challengeId: row.id,
        deviceId: row.device_id,
        status: 'rejected',
        reason: String(input.reason || '').trim().slice(0, 64) || null,
      },
      at: currentTime,
    });
    return { row: findChallenge.get(row.id) };
  });

  function rejectChallenge(input = {}) {
    assertAllowedKeys(input, REJECT_KEYS);
    const outcome = rejectTransaction(input);
    if (outcome.errorCode) throw serviceError(outcome.errorCode);
    return presentChallenge(outcome.row);
  }

  const exchangeTransaction = db.transaction(function (input, options = {}) {
    const deferActivation = options?.deferActivation === true;
    const challengeId = String(input.challengeId || '').trim();
    const row = findChallenge.get(challengeId);
    if (!row) throw serviceError('DESKTOP_CHALLENGE_NOT_FOUND');
    const passwordResetRetry = row.status === 'exchanged' && row.purpose === 'password_reset';
    if (row.status === 'exchanged' && !passwordResetRetry) {
      throw serviceError('DESKTOP_CHALLENGE_ALREADY_EXCHANGED');
    }
    const currentTime = timestamp();
    if (!passwordResetRetry && expireChallengeIfNeeded(row, currentTime)) {
      return { errorCode: 'DESKTOP_CHALLENGE_EXPIRED' };
    }
    if (!passwordResetRetry && row.status !== 'approved_pending_exchange') {
      throw serviceError('DESKTOP_CHALLENGE_STATE_INVALID');
    }
    if (!Number.isSafeInteger(input.expectedRowVersion)
      || Number(input.expectedRowVersion) !== Number(row.row_version) - (passwordResetRetry ? 1 : 0)) {
      throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    }
    if (!safeHashEqual(input.challengeSecret, row.challenge_token_hash)) {
      throw serviceError('DESKTOP_CHALLENGE_SECRET_INVALID');
    }
    const signature = String(input.signature || '').trim();
    if (!signature) throw serviceError('DESKTOP_DEVICE_SIGNATURE_REQUIRED');
    let signatureBuffer;
    try {
      signatureBuffer = Buffer.from(signature, 'base64');
    } catch (_error) {
      throw serviceError('DESKTOP_DEVICE_SIGNATURE_INVALID');
    }
    if (signatureBuffer.length !== 64) throw serviceError('DESKTOP_DEVICE_SIGNATURE_INVALID');
    const payload = desktopExchangeSigningPayload({
      challengeId: row.id,
      deviceId: row.device_id,
      rowVersion: Number(input.expectedRowVersion),
      challengeSecret: input.challengeSecret,
    });
    let signatureValid = false;
    try {
      signatureValid = crypto.verify(
        null,
        Buffer.from(payload, 'utf8'),
        crypto.createPublicKey(row.public_key),
        signatureBuffer
      );
    } catch (_error) {
      signatureValid = false;
    }
    if (!signatureValid) throw serviceError('DESKTOP_DEVICE_SIGNATURE_INVALID');

    const authorization = findAuthorizationById.get(row.authorization_id);
    const expectedAuthorizationStatus = row.purpose === 'password_reset' ? 'active' : 'pending';
    if (!authorization || authorization.status !== expectedAuthorizationStatus) {
      throw serviceError('DESKTOP_AUTHORIZATION_STATE_INVALID');
    }
    if (passwordResetRetry) {
      if (authorization.key_fingerprint !== row.key_fingerprint) {
        throw serviceError('DESKTOP_AUTHORIZATION_STATE_INVALID');
      }
      return { challenge: row, authorization };
    }
    if (deferActivation) {
      return { challenge: row, authorization };
    }
    const challengeUpdate = db.prepare(`UPDATE desktop_identity_challenges
      SET status='exchanged', exchanged_at=?, row_version=row_version+1, updated_at=?
      WHERE id=? AND status='approved_pending_exchange' AND row_version=?`)
      .run(currentTime, currentTime, row.id, row.row_version);
    if (challengeUpdate.changes !== 1) throw serviceError('DESKTOP_CHALLENGE_VERSION_STALE');
    const authorizationUpdate = row.purpose === 'password_reset'
      ? db.prepare(`UPDATE desktop_device_authorizations
          SET public_key=?, key_fingerprint=?, credential_version=credential_version+1,
              last_phone_verified_at=?, phone_reverify_due_at=?,
              row_version=row_version+1, updated_at=?
          WHERE id=? AND status='active' AND row_version=?`)
        .run(
          row.public_key,
          row.key_fingerprint,
          row.phone_verified_at,
          new Date(Date.parse(row.phone_verified_at) + PHONE_REVERIFY_MS).toISOString(),
          currentTime,
          authorization.id,
          authorization.row_version
        )
      : db.prepare(`UPDATE desktop_device_authorizations
          SET status='active', row_version=row_version+1, updated_at=?
          WHERE id=? AND status='pending' AND row_version=?`)
        .run(currentTime, authorization.id, authorization.row_version);
    if (authorizationUpdate.changes !== 1) throw serviceError('DESKTOP_AUTHORIZATION_VERSION_STALE');
    appendAudit({
      actorUserId: row.claimed_user_id,
      targetUserId: row.claimed_user_id,
      action: row.purpose === 'password_reset'
        ? 'desktop_device_password_reset_exchanged'
        : 'desktop_device_authorization_exchanged',
      before: { challengeId: row.id, status: row.status },
      after: { challengeId: row.id, deviceId: row.device_id, status: 'active' },
      at: currentTime,
    });
    return {
      challenge: findChallenge.get(row.id),
      authorization: findAuthorizationById.get(authorization.id),
    };
  });

  function exchangeChallenge(input = {}) {
    assertAllowedKeys(input, EXCHANGE_KEYS);
    const outcome = exchangeTransaction(input);
    if (outcome.errorCode) throw serviceError(outcome.errorCode);
    return Object.freeze({
      challenge: presentChallenge(outcome.challenge),
      authorization: presentAuthorization(outcome.authorization),
    });
  }

  function beginActivation(input = {}) {
    assertAllowedKeys(input, EXCHANGE_KEYS);
    const outcome = exchangeTransaction(input, { deferActivation: true });
    if (outcome.errorCode) throw serviceError(outcome.errorCode);
    return Object.freeze({
      challenge: presentChallenge(outcome.challenge),
      authorization: presentAuthorization(outcome.authorization),
    });
  }

  function listPendingAuthorizations() {
    const rows = db.prepare(`SELECT * FROM desktop_identity_challenges
      WHERE status='identity_verified_pending_approval'
      ORDER BY created_at ASC, id ASC`).all();
    return Object.freeze(rows.map(function (row) {
      return Object.freeze({
        challenge: presentChallenge(row),
        claimant: presentClaimant(row.claimed_user_id),
      });
    }));
  }

  function listDevicesForUser(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) throw serviceError('DESKTOP_USER_ID_REQUIRED');
    return Object.freeze(db.prepare(`SELECT * FROM desktop_device_authorizations
      WHERE user_id=? ORDER BY created_at ASC, id ASC`).all(normalizedUserId).map(presentAuthorization));
  }

  function listAllDevices() {
    return Object.freeze(db.prepare(`SELECT * FROM desktop_device_authorizations
      ORDER BY created_at ASC, id ASC`).all().map(presentAuthorization));
  }

  return Object.freeze({
    abandonPendingChallenge,
    approveChallenge,
    beginActivation,
    confirmVerifiedIdentity,
    exchangeChallenge,
    listAllDevices,
    listDevicesForUser,
    listPendingAuthorizations,
    readChallenge,
    readMiniappChallenge,
    readPublicChallenge,
    rejectChallenge,
    startChallenge,
    verifyChallengeSecret,
  });
}

module.exports = {
  ACTIVE_CHALLENGE_STATUSES,
  createDesktopIdentityService,
  desktopExchangeSigningPayload,
  fingerprintPublicKey,
};
