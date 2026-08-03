const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const OFFLINE_LEASE_MAX_MS = 14 * 24 * 60 * 60 * 1000;

function serviceError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requiredString(value, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw serviceError(code);
  return normalized;
}

function requiredInteger(value, code) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw serviceError(code);
  return normalized;
}

function requiredTimestamp(value, code) {
  const normalized = requiredString(value, code, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw serviceError(code);
  return normalized;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function desktopDeviceSessionSigningPayload(input = {}) {
  const challengeId = requiredString(
    input.challengeId || input.id,
    'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID',
    128
  );
  const authorizationId = requiredString(
    input.authorizationId || input.authorization_id,
    'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID',
    128
  );
  const deviceId = requiredString(
    input.deviceId || input.device_id,
    'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID',
    128
  );
  const credentialVersion = requiredInteger(
    input.credentialVersion || input.credential_version,
    'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID'
  );
  const nonceIssuedAt = requiredTimestamp(
    input.nonceIssuedAt || input.nonce_issued_at,
    'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID'
  );
  const nonceHash = input.nonceHash || input.nonce_hash
    ? requiredString(
      input.nonceHash || input.nonce_hash,
      'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID',
      64
    ).toLowerCase()
    : sha256(requiredString(input.nonce, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID', 2048));
  if (!/^[a-f0-9]{64}$/.test(nonceHash)) {
    throw serviceError('DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID');
  }
  return [
    'gewu-desktop-session-v2',
    challengeId,
    authorizationId,
    deviceId,
    String(credentialVersion),
    nonceIssuedAt,
    nonceHash,
  ].join('\n');
}

function approvedUser(user) {
  return Boolean(user)
    && user.deleted !== 1
    && user.status !== 0
    && user.login_enabled !== 0
    && user.review_status === 'approved';
}

function createDesktopOfflineLease({
  authorization = {},
  session = {},
  issuedAt = new Date(),
  leaseId,
  maxDurationMs = OFFLINE_LEASE_MAX_MS,
} = {}) {
  const current = issuedAt instanceof Date ? new Date(issuedAt) : new Date(issuedAt);
  if (!Number.isFinite(current.getTime())
    || !Number.isSafeInteger(maxDurationMs)
    || maxDurationMs < 60 * 1000
    || maxDurationMs > OFFLINE_LEASE_MAX_MS) {
    throw serviceError('DESKTOP_OFFLINE_LEASE_INPUT_INVALID');
  }
  const authorizationId = requiredString(
    authorization.id || authorization.authorizationId,
    'DESKTOP_OFFLINE_LEASE_INPUT_INVALID',
    128
  );
  const deviceId = requiredString(
    authorization.deviceId || authorization.device_id || session.deviceId,
    'DESKTOP_OFFLINE_LEASE_INPUT_INVALID',
    128
  );
  const userId = requiredString(
    authorization.userId || authorization.user_id || session.userId,
    'DESKTOP_OFFLINE_LEASE_INPUT_INVALID',
    128
  );
  const credentialVersion = requiredInteger(
    authorization.credentialVersion || authorization.credential_version,
    'DESKTOP_OFFLINE_LEASE_INPUT_INVALID'
  );
  const authorizationSource = String(
    authorization.authorizationSource || authorization.authorization_source || 'wechat_phone'
  );
  const phoneReverifyDueAt = authorizationSource === 'wechat_phone'
    ? requiredTimestamp(
      authorization.phoneReverifyDueAt || authorization.phone_reverify_due_at,
      'DESKTOP_OFFLINE_LEASE_INPUT_INVALID'
    )
    : null;
  const activeRole = requiredString(session.activeRole, 'DESKTOP_OFFLINE_LEASE_INPUT_INVALID', 32);
  const eligibleRoles = Array.isArray(session.eligibleRoles)
    ? [...new Set(session.eligibleRoles.map(String))]
    : [];
  if (!eligibleRoles.includes(activeRole)) throw serviceError('DESKTOP_OFFLINE_LEASE_INPUT_INVALID');
  const expiresAtMs = authorizationSource === 'wechat_phone'
    ? Math.min(current.getTime() + maxDurationMs, Date.parse(phoneReverifyDueAt))
    : current.getTime() + maxDurationMs;
  if (expiresAtMs <= current.getTime()) throw serviceError('DESKTOP_PHONE_REVERIFICATION_REQUIRED');
  let scope = { kind: activeRole, all: true };
  if (activeRole === 'teacher') scope = { kind: 'teacher', teacherId: session.teacherId };
  if (activeRole === 'student' || activeRole === 'parent') {
    scope = { kind: activeRole, studentId: session.studentId };
  }
  return Object.freeze({
    id: String(leaseId || `desktop-offline:${session.id}:${current.toISOString()}`),
    userId,
    deviceId,
    authorizationId,
    credentialVersion,
    eligibleRoles: Object.freeze(eligibleRoles),
    activeRole,
    teacherId: session.teacherId || null,
    studentId: session.studentId || null,
    issuedAt: current.toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    scope: Object.freeze(scope),
  });
}

function createDesktopSessionProfile({ session = {}, user = {} } = {}) {
  const userId = requiredString(session.userId || user.id, 'DESKTOP_SESSION_PROFILE_INVALID', 128);
  const activeRole = requiredString(session.activeRole, 'DESKTOP_SESSION_PROFILE_INVALID', 32);
  const eligibleRoles = Array.isArray(session.eligibleRoles)
    ? [...new Set(session.eligibleRoles.map(String))]
    : [];
  if (!eligibleRoles.includes(activeRole)) throw serviceError('DESKTOP_SESSION_PROFILE_INVALID');
  return Object.freeze({
    userId,
    user: Object.freeze({
      id: userId,
      name: String(user.name || '').trim().slice(0, 128),
    }),
    eligibleRoles: Object.freeze(eligibleRoles),
    activeRole,
    teacherId: session.teacherId || null,
    studentId: session.studentId || null,
  });
}

function createDesktopDeviceChallengeService({
  db,
  sessionService,
  now = function () { return new Date(); },
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
  challengeTtlMs = CHALLENGE_TTL_MS,
  offlineLeaseMaxMs = OFFLINE_LEASE_MAX_MS,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw serviceError('DESKTOP_SESSION_CHALLENGE_DB_REQUIRED');
  }
  if (!sessionService || typeof sessionService.issueSession !== 'function') {
    throw serviceError('DESKTOP_SESSION_SERVICE_REQUIRED');
  }
  if (!Number.isSafeInteger(challengeTtlMs)
    || challengeTtlMs < 30 * 1000
    || challengeTtlMs > CHALLENGE_TTL_MS) {
    throw serviceError('DESKTOP_SESSION_CHALLENGE_TTL_INVALID');
  }
  if (!Number.isSafeInteger(offlineLeaseMaxMs)
    || offlineLeaseMaxMs < 60 * 1000
    || offlineLeaseMaxMs > OFFLINE_LEASE_MAX_MS) {
    throw serviceError('DESKTOP_OFFLINE_LEASE_DURATION_INVALID');
  }

  const findAuthorization = db.prepare(
    'SELECT * FROM desktop_device_authorizations WHERE id=?'
  );
  const findUser = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0');
  const findChallenge = db.prepare(
    'SELECT * FROM desktop_device_session_challenges WHERE id=?'
  );
  const insertChallenge = db.prepare(`INSERT INTO desktop_device_session_challenges
    (id, authorization_id, device_id, user_id, credential_version, nonce_hash,
     status, nonce_issued_at, expires_at, row_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?)`);
  const consumeChallenge = db.prepare(`UPDATE desktop_device_session_challenges
    SET status='consumed', consumed_at=?, row_version=row_version+1, updated_at=?
    WHERE id=? AND status='pending' AND row_version=?`);
  const attachSession = db.prepare(`UPDATE desktop_device_session_challenges
    SET issued_session_id=?, updated_at=?
    WHERE id=? AND status='consumed'`);

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw serviceError('DESKTOP_SESSION_CHALLENGE_CLOCK_INVALID');
    return date;
  }

  function activeAuthorization(input, current) {
    const authorizationId = requiredString(
      input.authorizationId,
      'DESKTOP_DEVICE_AUTHORIZATION_REQUIRED',
      128
    );
    const deviceId = requiredString(input.deviceId, 'DESKTOP_DEVICE_ID_REQUIRED', 128);
    const authorization = findAuthorization.get(authorizationId);
    if (!authorization) throw serviceError('DESKTOP_DEVICE_NOT_FOUND');
    if (authorization.device_id !== deviceId) {
      throw serviceError('DESKTOP_DEVICE_AUTHORIZATION_MISMATCH');
    }
    if (authorization.status !== 'active') throw serviceError('DESKTOP_DEVICE_NOT_ACTIVE');
    const authorizationSource = authorization.authorization_source || 'wechat_phone';
    if (authorizationSource === 'wechat_phone'
      && Date.parse(authorization.phone_reverify_due_at) <= current.getTime()) {
      throw serviceError('DESKTOP_PHONE_REVERIFICATION_REQUIRED');
    }
    if (!approvedUser(findUser.get(authorization.user_id))) {
      throw serviceError('DESKTOP_SESSION_USER_NOT_ACTIVE');
    }
    return authorization;
  }

  function startChallenge(input = {}) {
    const current = currentDate();
    const authorization = activeAuthorization(input, current);
    const id = requiredString(uuid(), 'DESKTOP_SESSION_CHALLENGE_ID_INVALID', 128);
    let nonceBytes;
    try {
      nonceBytes = Buffer.from(randomBytes(32));
    } catch (cause) {
      throw serviceError('DESKTOP_SESSION_CHALLENGE_RANDOM_FAILED', cause);
    }
    if (nonceBytes.length < 32) throw serviceError('DESKTOP_SESSION_CHALLENGE_RANDOM_FAILED');
    const nonce = nonceBytes.toString('base64url');
    const nonceHash = sha256(nonce);
    const nonceIssuedAt = current.toISOString();
    const expiresAt = new Date(current.getTime() + challengeTtlMs).toISOString();
    insertChallenge.run(
      id,
      authorization.id,
      authorization.device_id,
      authorization.user_id,
      Number(authorization.credential_version),
      nonceHash,
      nonceIssuedAt,
      expiresAt,
      nonceIssuedAt,
      nonceIssuedAt
    );
    return Object.freeze({
      id,
      authorizationId: authorization.id,
      deviceId: authorization.device_id,
      credentialVersion: Number(authorization.credential_version),
      nonce,
      nonceIssuedAt,
      status: 'pending',
      rowVersion: 1,
      expiresAt,
    });
  }

  function challengeForExchange(input, current) {
    const challengeId = requiredString(
      input.challengeId,
      'DESKTOP_SESSION_CHALLENGE_ID_REQUIRED',
      128
    );
    const challenge = findChallenge.get(challengeId);
    if (!challenge) throw serviceError('DESKTOP_SESSION_CHALLENGE_NOT_FOUND');
    if (challenge.status === 'consumed') throw serviceError('DESKTOP_SESSION_CHALLENGE_REPLAYED');
    if (challenge.status === 'expired' || Date.parse(challenge.expires_at) <= current.getTime()) {
      if (challenge.status === 'pending') {
        db.prepare(`UPDATE desktop_device_session_challenges
          SET status='expired', row_version=row_version+1, updated_at=?
          WHERE id=? AND status='pending'`).run(current.toISOString(), challenge.id);
      }
      throw serviceError('DESKTOP_SESSION_CHALLENGE_EXPIRED');
    }
    if (challenge.status !== 'pending') throw serviceError('DESKTOP_SESSION_CHALLENGE_STATE_INVALID');
    const expectedRowVersion = requiredInteger(
      input.expectedRowVersion,
      'DESKTOP_SESSION_CHALLENGE_VERSION_REQUIRED'
    );
    if (Number(challenge.row_version) !== expectedRowVersion) {
      throw serviceError('DESKTOP_SESSION_CHALLENGE_STALE');
    }
    const authorization = activeAuthorization({
      authorizationId: challenge.authorization_id,
      deviceId: challenge.device_id,
    }, current);
    if (authorization.user_id !== challenge.user_id
      || Number(authorization.credential_version) !== Number(challenge.credential_version)) {
      throw serviceError('DESKTOP_SESSION_CHALLENGE_CREDENTIAL_CHANGED');
    }
    return { challenge, authorization, expectedRowVersion };
  }

  function verifyProof(input, challenge, authorization) {
    const signatureText = requiredString(
      input.signature,
      'DESKTOP_SESSION_CHALLENGE_SIGNATURE_REQUIRED',
      256
    );
    let signature;
    let publicKey;
    try {
      signature = Buffer.from(signatureText, 'base64');
      publicKey = crypto.createPublicKey(authorization.public_key);
    } catch (cause) {
      throw serviceError('DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID', cause);
    }
    if (signature.length !== 64) {
      throw serviceError('DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID');
    }
    const payload = desktopDeviceSessionSigningPayload({
      challengeId: challenge.id,
      authorizationId: challenge.authorization_id,
      deviceId: challenge.device_id,
      credentialVersion: challenge.credential_version,
      nonceIssuedAt: challenge.nonce_issued_at,
      nonceHash: challenge.nonce_hash,
    });
    if (!crypto.verify(null, Buffer.from(payload, 'utf8'), publicKey, signature)) {
      throw serviceError('DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID');
    }
  }

  function leaseFor(issued, authorization, challenge, current) {
    return createDesktopOfflineLease({
      authorization,
      session: issued.session,
      issuedAt: current,
      leaseId: `desktop-offline:${challenge.id}`,
      maxDurationMs: offlineLeaseMaxMs,
    });
  }

  const consumeAndIssue = db.transaction(function ({ challenge, authorization, expectedRowVersion, current }) {
    const changed = consumeChallenge.run(
      current.toISOString(),
      current.toISOString(),
      challenge.id,
      expectedRowVersion
    );
    if (changed.changes !== 1) throw serviceError('DESKTOP_SESSION_CHALLENGE_REPLAYED');
    const issued = sessionService.issueSession({
      userId: authorization.user_id,
      deviceId: authorization.device_id,
      // The signature is produced only after the local vault has been unlocked
      // for this session challenge. Preserve that fresh local proof so a newly
      // unlocked super administrator can approve a device without a dead-end
      // second unlock step.
      authTime: current,
    });
    attachSession.run(issued.session.id, current.toISOString(), challenge.id);
    return {
      token: issued.token,
      session: issued.session,
      offlineLease: leaseFor(issued, authorization, challenge, current),
      profile: createDesktopSessionProfile({
        session: issued.session,
        user: findUser.get(authorization.user_id),
      }),
    };
  });

  function exchangeChallenge(input = {}) {
    const current = currentDate();
    const verified = challengeForExchange(input, current);
    verifyProof(input, verified.challenge, verified.authorization);
    return Object.freeze(consumeAndIssue({ ...verified, current }));
  }

  return Object.freeze({ exchangeChallenge, startChallenge });
}

module.exports = {
  CHALLENGE_TTL_MS,
  OFFLINE_LEASE_MAX_MS,
  createDesktopDeviceChallengeService,
  createDesktopOfflineLease,
  createDesktopSessionProfile,
  desktopDeviceSessionSigningPayload,
};
