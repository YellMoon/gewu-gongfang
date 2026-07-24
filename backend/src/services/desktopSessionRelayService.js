const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const taskService = require('./cloudRelayTaskService');
const { verifyRelayAssertion } = require('./relayAssertionService');

const DESKTOP_SESSION_RELAY_START = 'desktop-session-challenge-start';
const DESKTOP_SESSION_RELAY_EXCHANGE = 'desktop-session-challenge-exchange';
const DESKTOP_SESSION_RELAY_TTL_MS = 5 * 60 * 1000;
const TASK_TYPES = new Set([
  DESKTOP_SESSION_RELAY_START,
  DESKTOP_SESSION_RELAY_EXCHANGE,
]);

function relayError(code, message = code, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requiredText(value, code, maxLength = 256) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) throw relayError(code, code, 400);
  return text;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function hashDesktopSessionRelaySecret(secret) {
  return crypto.createHash('sha256')
    .update(requiredText(secret, 'DESKTOP_SESSION_RELAY_SECRET_REQUIRED', 512), 'utf8')
    .digest('hex');
}

function validSecretHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw relayError('DESKTOP_SESSION_RELAY_SECRET_HASH_INVALID', undefined, 400);
  }
  return hash;
}

function sameHash(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length === 32
    && rightBuffer.length === 32
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createDesktopSessionRelayService({
  db,
  now = () => new Date(),
  idFactory = prefix => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
  requestTtlMs = DESKTOP_SESSION_RELAY_TTL_MS,
  relayAssertionSecret = '',
  jwtSecret = '',
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw relayError('DESKTOP_SESSION_RELAY_DB_REQUIRED', undefined, 500);
  }
  if (!Number.isSafeInteger(requestTtlMs) || requestTtlMs < 60 * 1000 || requestTtlMs > 10 * 60 * 1000) {
    throw relayError('DESKTOP_SESSION_RELAY_TTL_INVALID', undefined, 500);
  }

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw relayError('DESKTOP_SESSION_RELAY_CLOCK_INVALID', undefined, 500);
    return date;
  }

  function taskRow(requestId) {
    const row = db.prepare('SELECT * FROM miniapp_tasks WHERE id=?').get(
      requiredText(requestId, 'DESKTOP_SESSION_RELAY_REQUEST_ID_REQUIRED', 128)
    );
    if (!row || !TASK_TYPES.has(row.task_type)) {
      throw relayError('DESKTOP_SESSION_RELAY_REQUEST_NOT_FOUND', undefined, 404);
    }
    return {
      ...row,
      payload: parseJson(row.payload, {}),
      result_payload: parseJson(row.result_payload, null),
    };
  }

  function assertFresh(row, current = currentDate()) {
    const createdAt = Date.parse(String(row.created_at || ''));
    if (!Number.isFinite(createdAt) || current.getTime() - createdAt > requestTtlMs) {
      throw relayError('DESKTOP_SESSION_RELAY_REQUEST_EXPIRED', undefined, 410);
    }
    return row;
  }

  function assertSecret(row, requestSecret) {
    const expected = validSecretHash(row.payload.requestSecretHash);
    const actual = hashDesktopSessionRelaySecret(requestSecret);
    if (!sameHash(expected, actual)) {
      throw relayError('DESKTOP_SESSION_RELAY_SECRET_INVALID', undefined, 403);
    }
    return row;
  }

  function materializeExchangeResult(row) {
    const result = row.result_payload;
    if (row.task_type !== DESKTOP_SESSION_RELAY_EXCHANGE
      || row.status !== 'completed'
      || !result?.relayAssertion) {
      return result || null;
    }
    if (!relayAssertionSecret) {
      throw relayError('DESKTOP_SESSION_RELAY_ASSERTION_SECRET_REQUIRED', undefined, 500);
    }
    if (!jwtSecret) {
      throw relayError('DESKTOP_SESSION_RELAY_JWT_SECRET_REQUIRED', undefined, 500);
    }
    let claims;
    try {
      claims = verifyRelayAssertion(result.relayAssertion, relayAssertionSecret, {
        now: currentDate().getTime(),
      });
    } catch (error) {
      throw relayError(error.code || 'DESKTOP_SESSION_RELAY_ASSERTION_INVALID', undefined, 403);
    }
    const session = result.session || {};
    const profile = result.profile || {};
    const eligibleRoles = Array.isArray(session.eligibleRoles)
      ? session.eligibleRoles.map(role => String(role || '').trim()).filter(Boolean)
      : [];
    const teacherId = session.teacherId || profile.teacherId || null;
    const studentId = session.studentId || profile.studentId || null;
    const matches = claims.taskId === row.id
      && claims.actorUserId === session.userId
      && claims.deviceId === session.deviceId
      && claims.sessionId === session.id
      && claims.activeRole === session.activeRole
      && claims.authVersion === Number(session.authVersion)
      && claims.credentialVersion === Number(session.credentialVersion)
      && eligibleRoles.includes(claims.activeRole)
      && (claims.activeRole !== 'teacher' || claims.teacherId === teacherId);
    if (!matches) {
      throw relayError('DESKTOP_SESSION_RELAY_ASSERTION_MISMATCH', undefined, 403);
    }
    const token = jwt.sign({
      sub: claims.actorUserId,
      sid: claims.sessionId,
      device_id: claims.deviceId,
      eligible_roles: eligibleRoles,
      active_role: claims.activeRole,
      teacher_id: teacherId,
      student_id: studentId,
      auth_version: claims.authVersion,
      credential_version: claims.credentialVersion,
      token_use: 'desktop-relay-session',
      iss: 'gewu-auth',
      aud: 'gewu-api',
      iat: Math.floor(claims.issuedAt / 1000),
      exp: Math.floor(claims.expiresAt / 1000),
    }, jwtSecret, { algorithm: 'HS256' });
    const { relayAssertion: _relayAssertion, ...safeResult } = result;
    return Object.freeze({ ...safeResult, token });
  }

  function present(row) {
    return Object.freeze({
      id: row.id,
      taskType: row.task_type,
      status: row.status,
      targetHostDeviceId: row.target_host_device_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      result: materializeExchangeResult(row),
      errorCode: row.error_code || null,
    });
  }

  function createTask({ taskType, payload, deviceId, targetHostDeviceId, idempotencyKey }) {
    const current = currentDate();
    const deadlineAt = new Date(current.getTime() + requestTtlMs).toISOString();
    const result = taskService.createV2Task(db, {
      taskType,
      payload,
      createdBy: `desktop-session:${deviceId}`,
      tenantId: 'default',
      actorRole: 'desktop-client',
      allowDraft: false,
      targetHostDeviceId,
      idempotencyKey,
      maxAttempts: 3,
      deadlineAt,
      resultExpiresAt: deadlineAt,
    }, {
      internal: true,
      now: current.toISOString(),
      idFactory: () => idFactory(taskType === DESKTOP_SESSION_RELAY_START
        ? 'desktop_session_start'
        : 'desktop_session_exchange'),
    });
    return present(result.task);
  }

  function createStartRequest(input = {}) {
    const authorizationId = requiredText(
      input.authorizationId,
      'DESKTOP_SESSION_RELAY_AUTHORIZATION_REQUIRED',
      128
    );
    const deviceId = requiredText(input.deviceId, 'DESKTOP_SESSION_RELAY_DEVICE_REQUIRED', 128);
    const targetHostDeviceId = requiredText(
      input.targetHostDeviceId,
      'DESKTOP_SESSION_RELAY_HOST_REQUIRED',
      128
    );
    const requestSecretHash = validSecretHash(input.requestSecretHash);
    return createTask({
      taskType: DESKTOP_SESSION_RELAY_START,
      payload: { authorizationId, deviceId, requestSecretHash },
      deviceId,
      targetHostDeviceId,
      idempotencyKey: `start:${requestSecretHash}`,
    });
  }

  function readRequest(input = {}) {
    const row = assertSecret(assertFresh(taskRow(input.requestId)), input.requestSecret);
    return present(row);
  }

  function createExchangeRequest(input = {}) {
    const start = assertSecret(assertFresh(taskRow(input.startRequestId)), input.requestSecret);
    if (start.task_type !== DESKTOP_SESSION_RELAY_START || start.status !== 'completed') {
      throw relayError('DESKTOP_SESSION_RELAY_START_NOT_COMPLETED');
    }
    const challenge = start.result_payload?.challenge;
    const challengeId = requiredText(input.challengeId, 'DESKTOP_SESSION_RELAY_CHALLENGE_REQUIRED', 128);
    if (!challenge?.id || challenge.id !== challengeId) {
      throw relayError('DESKTOP_SESSION_RELAY_CHALLENGE_MISMATCH', undefined, 400);
    }
    const signature = requiredText(input.signature, 'DESKTOP_SESSION_RELAY_SIGNATURE_REQUIRED', 256);
    const expectedRowVersion = Number(input.expectedRowVersion);
    if (!Number.isSafeInteger(expectedRowVersion) || expectedRowVersion < 1) {
      throw relayError('DESKTOP_SESSION_RELAY_ROW_VERSION_REQUIRED', undefined, 400);
    }
    return createTask({
      taskType: DESKTOP_SESSION_RELAY_EXCHANGE,
      payload: {
        startRequestId: start.id,
        authorizationId: start.payload.authorizationId,
        deviceId: start.payload.deviceId,
        challengeId,
        signature,
        expectedRowVersion,
        requestSecretHash: start.payload.requestSecretHash,
      },
      deviceId: start.payload.deviceId,
      targetHostDeviceId: start.target_host_device_id,
      idempotencyKey: `exchange:${start.id}:${challengeId}`,
    });
  }

  return Object.freeze({
    createExchangeRequest,
    createStartRequest,
    readRequest,
  });
}

module.exports = {
  DESKTOP_SESSION_RELAY_EXCHANGE,
  DESKTOP_SESSION_RELAY_START,
  DESKTOP_SESSION_RELAY_TTL_MS,
  createDesktopSessionRelayService,
  hashDesktopSessionRelaySecret,
};
