'use strict';

const crypto = require('crypto');
const { types } = require('util');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const ELEVATION_MAX_AGE_MS = 5 * 60 * 1000;
const DESKTOP_ROLES = new Set(['super_admin', 'teacher']);
const REVOCATION_REASONS = new Set(['lost', 'replaced', 'user_request', 'security']);

function failure(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys, code = 'DESKTOP_IDENTITY_INPUT_INVALID') {
  if (!plain(value) || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw failure(code);
  return value;
}

function text(value, code = 'DESKTOP_IDENTITY_INPUT_INVALID', max = 8192) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) throw failure(code);
  return value;
}

function version(value, code = 'DESKTOP_DEVICE_ROW_VERSION_INVALID') {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw failure(code);
  return normalized;
}

function instant(value, code = 'DESKTOP_IDENTITY_INPUT_INVALID') {
  const normalized = String(value || '').trim();
  if (!normalized || !Number.isFinite(Date.parse(normalized))) throw failure(code);
  return new Date(normalized).toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonicalEvidence(request, result, payload = result) {
  const canonicalRequestJson = JSON.stringify(request);
  const canonicalResultJson = JSON.stringify(result);
  const canonicalPayloadJson = JSON.stringify(payload);
  return Object.freeze({
    canonicalRequestSha256: sha256(canonicalRequestJson),
    canonicalResultJson,
    canonicalResultSha256: sha256(canonicalResultJson),
    canonicalPayloadJson,
    canonicalPayloadSha256: sha256(canonicalPayloadJson),
  });
}

function uniqueRoles(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(role => DESKTOP_ROLES.has(role)))];
}

function desktopSessionChallengeSigningPayload(input = {}) {
  const challengeId = text(input.challengeId || input.id, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID', 128);
  const authorizationId = text(input.authorizationId, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID', 128);
  const deviceId = text(input.deviceId, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID', 128);
  const credentialVersion = version(input.credentialVersion, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID');
  const nonceIssuedAt = instant(input.nonceIssuedAt, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID');
  const nonceSha256 = input.nonceSha256
    ? text(input.nonceSha256, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID', 64)
    : sha256(text(input.nonce, 'DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID', 1024));
  if (!/^[0-9a-f]{64}$/u.test(nonceSha256)) throw failure('DESKTOP_SESSION_CHALLENGE_PAYLOAD_INVALID');
  return ['gewu-desktop-session-v2', challengeId, authorizationId, deviceId, String(credentialVersion), nonceIssuedAt, nonceSha256].join('\n');
}

function desktopRoleElevationSigningPayload(input = {}) {
  const sessionId = text(input.sessionId, 'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID', 128);
  const deviceId = text(input.deviceId, 'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID', 128);
  const activeRole = text(input.activeRole, 'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID', 32);
  if (!DESKTOP_ROLES.has(activeRole)) throw failure('DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID');
  const sessionVersion = version(input.sessionVersion, 'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID');
  const elevationIssuedAt = instant(input.elevationIssuedAt, 'DESKTOP_ROLE_ELEVATION_PAYLOAD_INVALID');
  return ['gewu-desktop-role-elevation-v1', sessionId, deviceId, activeRole, String(sessionVersion), elevationIssuedAt].join('\n');
}

function verifyEd25519(publicKey, payload, encodedSignature, code) {
  let signature;
  try {
    signature = Buffer.from(text(encodedSignature, code, 1024), 'base64');
  } catch (cause) {
    throw failure(code, cause);
  }
  if (signature.length !== 64) throw failure(code);
  try {
    if (!crypto.verify(null, Buffer.from(payload, 'utf8'), crypto.createPublicKey(publicKey), signature)) throw failure(code);
  } catch (cause) {
    if (cause?.code === code) throw cause;
    throw failure(code, cause);
  }
}

function checkedNow(now) {
  const current = now();
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw failure('DESKTOP_IDENTITY_CLOCK_INVALID');
  return new Date(current);
}

function idFactory(randomId, kind) {
  return text(String(randomId(kind)), 'DESKTOP_IDENTITY_RANDOM_FAILED', 128);
}

function validateIssued(value) {
  if (!plain(value) || typeof value.token !== 'string' || !value.token
    || !plain(value.session) || !value.session.id || !value.session.activeRole
    || !plain(value.profile) || !plain(value.offlineLease)) throw failure('CLOUD_ONLINE_IDENTITY_REJECTED');
  return value;
}

function createCloudDesktopIdentityService({ repository, sessionContext, issueSession, now = () => new Date(), randomBytes = crypto.randomBytes, randomId = kind => `${kind}-${crypto.randomUUID()}` } = {}) {
  const repositoryMethods = ['createChallenge', 'readChallenge', 'consumeChallengeAndCreateSession', 'readInstallationForSession', 'rotateRoleSession', 'listDevices', 'revokeDevice'];
  if (!repository || repositoryMethods.some(method => typeof repository[method] !== 'function')
    || typeof sessionContext !== 'function' || typeof issueSession !== 'function'
    || typeof now !== 'function' || typeof randomBytes !== 'function' || typeof randomId !== 'function') {
    throw failure('CLOUD_DESKTOP_IDENTITY_CONFIG_INVALID');
  }

  async function startChallenge(input) {
    const request = exact(input, ['authorizationId', 'deviceId']);
    const authorizationId = text(request.authorizationId, 'DESKTOP_SESSION_CHALLENGE_INPUT_INVALID', 128);
    const deviceId = text(request.deviceId, 'DESKTOP_SESSION_CHALLENGE_INPUT_INVALID', 128);
    const current = checkedNow(now);
    let nonce;
    try {
      const bytes = randomBytes(32);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new Error('random bytes invalid');
      nonce = bytes.toString('base64url');
    } catch (cause) {
      throw failure('DESKTOP_SESSION_CHALLENGE_RANDOM_FAILED', cause);
    }
    const row = await repository.createChallenge({
      challengeId: idFactory(randomId, 'desktop-session-challenge'),
      authorizationId,
      deviceId,
      nonceSha256: sha256(nonce),
      nonceIssuedAt: current.toISOString(),
      expiresAt: new Date(current.getTime() + CHALLENGE_TTL_MS).toISOString(),
    });
    if (!plain(row) || row.status !== 'pending' || row.authorizationId !== authorizationId || row.deviceId !== deviceId) {
      throw failure('DESKTOP_SESSION_CHALLENGE_STATE_INVALID');
    }
    return Object.freeze({
      id: text(row.challengeId, 'DESKTOP_SESSION_CHALLENGE_STATE_INVALID', 128),
      authorizationId,
      credentialVersion: version(row.credentialVersion, 'DESKTOP_SESSION_CHALLENGE_STATE_INVALID'),
      nonce,
      nonceIssuedAt: current.toISOString(),
      rowVersion: version(row.rowVersion, 'DESKTOP_SESSION_CHALLENGE_STATE_INVALID'),
      expiresAt: instant(row.expiresAt, 'DESKTOP_SESSION_CHALLENGE_STATE_INVALID'),
    });
  }

  async function exchangeChallenge(input) {
    const request = exact(input, ['challengeId', 'signature', 'expectedRowVersion']);
    const challengeId = text(request.challengeId, 'DESKTOP_SESSION_CHALLENGE_ID_REQUIRED', 128);
    const expectedRowVersion = version(request.expectedRowVersion, 'DESKTOP_SESSION_CHALLENGE_STALE');
    const row = await repository.readChallenge({ challengeId });
    if (!row) throw failure('DESKTOP_SESSION_CHALLENGE_NOT_FOUND');
    if (row.status === 'consumed') throw failure('DESKTOP_SESSION_CHALLENGE_REPLAYED');
    const current = checkedNow(now);
    if (row.status !== 'pending') throw failure('DESKTOP_SESSION_CHALLENGE_STATE_INVALID');
    if (Date.parse(row.expiresAt) <= current.getTime()) throw failure('DESKTOP_SESSION_CHALLENGE_EXPIRED');
    if (version(row.rowVersion, 'DESKTOP_SESSION_CHALLENGE_STALE') !== expectedRowVersion) throw failure('DESKTOP_SESSION_CHALLENGE_STALE');
    verifyEd25519(
      row.installationPublicKey,
      desktopSessionChallengeSigningPayload({
        challengeId,
        authorizationId: row.authorizationId,
        deviceId: row.deviceId,
        credentialVersion: row.credentialVersion,
        nonceSha256: row.nonceSha256,
        nonceIssuedAt: row.nonceIssuedAt,
      }),
      request.signature,
      'DESKTOP_SESSION_CHALLENGE_SIGNATURE_INVALID',
    );
    const sessionId = idFactory(randomId, 'desktop-session');
    const sessionExpiresAt = new Date(current.getTime() + SESSION_TTL_MS).toISOString();
    const evidence = canonicalEvidence(
      { challengeId, expectedRowVersion, signatureSha256: sha256(request.signature) },
      { sessionId, status: 'active' },
    );
    const created = await repository.consumeChallengeAndCreateSession({
      challengeId,
      expectedRowVersion,
      sessionId,
      sessionExpiresAt,
      receiptId: idFactory(randomId, 'desktop-session-receipt'),
      auditEventId: idFactory(randomId, 'desktop-session-audit'),
      outboxEventId: idFactory(randomId, 'desktop-session-outbox'),
      signatureSha256: sha256(request.signature),
      ...evidence,
    });
    if (!created) throw failure('DESKTOP_SESSION_CHALLENGE_REPLAYED');
    return validateIssued(await issueSession({ ...created, activeRole: null }));
  }

  async function checkedContext(sessionToken) {
    const token = text(sessionToken, 'DESKTOP_SESSION_REQUIRED', 4096);
    let context;
    try {
      context = await sessionContext({ sessionToken: token });
    } catch (_) {
      throw failure('DESKTOP_SESSION_REQUIRED');
    }
    if (!plain(context) || !text(context.sessionId, 'DESKTOP_SESSION_REQUIRED', 128)
      || !text(context.deviceId, 'DESKTOP_SESSION_REQUIRED', 128)
      || !text(context.accountId, 'DESKTOP_SESSION_REQUIRED', 128)
      || !text(context.authorityId, 'DESKTOP_SESSION_REQUIRED', 128)
      || !DESKTOP_ROLES.has(context.activeRole) || uniqueRoles(context.roles).length === 0) throw failure('DESKTOP_SESSION_REQUIRED');
    return context;
  }

  async function switchRole(input) {
    if (!plain(input)) throw failure('DESKTOP_ROLE_SWITCH_INPUT_INVALID');
    const allowed = ['sessionToken', 'activeRole', 'elevationIssuedAt', 'elevationSignature'];
    if (Reflect.ownKeys(input).some(key => !allowed.includes(key))) throw failure('DESKTOP_IDENTITY_INPUT_FORBIDDEN');
    const activeRole = text(input.activeRole, 'DESKTOP_ROLE_SWITCH_INPUT_INVALID', 32);
    if (!DESKTOP_ROLES.has(activeRole)) throw failure('ACTIVE_ROLE_NOT_GRANTED');
    const context = await checkedContext(input.sessionToken);
    if (context.activeRole === activeRole) throw failure('DESKTOP_ACTIVE_ROLE_UNCHANGED');
    if (!uniqueRoles(context.roles).includes(activeRole)) throw failure('ACTIVE_ROLE_NOT_GRANTED');
    if (activeRole === 'super_admin' && context.activeRole !== 'super_admin') {
      const elevationIssuedAt = instant(input.elevationIssuedAt, 'DESKTOP_ROLE_ELEVATION_PROOF_STALE');
      const issuedAtMs = Date.parse(elevationIssuedAt);
      const current = checkedNow(now);
      if (issuedAtMs > current.getTime() + 30 * 1000 || current.getTime() - issuedAtMs > ELEVATION_MAX_AGE_MS) {
        throw failure('DESKTOP_ROLE_ELEVATION_PROOF_STALE');
      }
      const installation = await repository.readInstallationForSession({
        authorityId: context.authorityId,
        accountId: context.accountId,
        sessionId: context.sessionId,
      });
      if (!installation?.installationPublicKey) throw failure('DESKTOP_SESSION_REQUIRED');
      verifyEd25519(
        installation.installationPublicKey,
        desktopRoleElevationSigningPayload({
          sessionId: context.sessionId,
          deviceId: context.deviceId,
          activeRole,
          sessionVersion: context.rowVersion,
          elevationIssuedAt,
        }),
        input.elevationSignature,
        'DESKTOP_ROLE_ELEVATION_SIGNATURE_INVALID',
      );
    } else if (input.elevationIssuedAt !== undefined || input.elevationSignature !== undefined) {
      throw failure('DESKTOP_IDENTITY_INPUT_FORBIDDEN');
    }
    const nextSessionId = idFactory(randomId, 'desktop-role-session');
    const evidence = canonicalEvidence(
      { previousSessionId: context.sessionId, expectedRowVersion: context.rowVersion, activeRole },
      { sessionId: nextSessionId, activeRole, status: 'active' },
    );
    const created = await repository.rotateRoleSession({
      authorityId: context.authorityId,
      accountId: context.accountId,
      previousSessionId: context.sessionId,
      expectedRowVersion: version(context.rowVersion, 'DESKTOP_SESSION_VERSION_MISMATCH'),
      sessionId: nextSessionId,
      activeRole,
      receiptId: idFactory(randomId, 'desktop-role-receipt'),
      auditEventId: idFactory(randomId, 'desktop-role-audit'),
      outboxEventId: idFactory(randomId, 'desktop-role-outbox'),
      ...evidence,
    });
    if (!created) throw failure('DESKTOP_SESSION_VERSION_MISMATCH');
    return validateIssued(await issueSession({ ...created, activeRole }));
  }

  async function listDevices(input) {
    const request = exact(input, ['sessionToken']);
    const context = await checkedContext(request.sessionToken);
    const rows = await repository.listDevices({ authorityId: context.authorityId, accountId: context.accountId });
    if (!Array.isArray(rows)) throw failure('DESKTOP_DEVICE_CENTER_UNAVAILABLE');
    return Object.freeze(rows.map(row => Object.freeze({
      id: text(row.deviceId, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID', 128),
      deviceId: row.deviceId,
      deviceName: null,
      status: text(row.status, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID', 32),
      approvedAt: row.createdAt ? instant(row.createdAt, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID') : null,
      rowVersion: version(row.rowVersion, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID'),
      createdAt: row.createdAt ? instant(row.createdAt, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID') : null,
      updatedAt: row.updatedAt ? instant(row.updatedAt, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID') : null,
      lastSeenAt: row.lastSeenAt ? instant(row.lastSeenAt, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID') : null,
      revokedAt: row.revokedAt ? instant(row.revokedAt, 'DESKTOP_DEVICE_CENTER_RESPONSE_INVALID') : null,
    })));
  }

  async function revokeDevice(input) {
    const request = exact(input, ['sessionToken', 'deviceId', 'expectedRowVersion', 'reason']);
    const context = await checkedContext(request.sessionToken);
    if (context.activeRole !== 'super_admin') throw failure('DESKTOP_SUPER_ADMIN_ROLE_REQUIRED');
    const deviceId = text(request.deviceId, 'DESKTOP_DEVICE_REVOCATION_INPUT_INVALID', 128);
    if (deviceId === context.deviceId) throw failure('DESKTOP_DEVICE_SELF_REVOCATION_FORBIDDEN');
    const reason = text(request.reason, 'DESKTOP_DEVICE_REVOCATION_INPUT_INVALID', 32);
    if (!REVOCATION_REASONS.has(reason)) throw failure('DESKTOP_DEVICE_REVOCATION_INPUT_INVALID');
    const evidence = canonicalEvidence(
      { deviceId, expectedRowVersion: request.expectedRowVersion, reason },
      { deviceId, status: 'revoked', reason },
    );
    const revoked = await repository.revokeDevice({
      authorityId: context.authorityId,
      actorAccountId: context.accountId,
      actorSessionId: context.sessionId,
      deviceId,
      expectedRowVersion: version(request.expectedRowVersion),
      reason,
      receiptId: idFactory(randomId, 'desktop-device-receipt'),
      auditEventId: idFactory(randomId, 'desktop-device-audit'),
      outboxEventId: idFactory(randomId, 'desktop-device-outbox'),
      ...evidence,
    });
    if (!revoked) throw failure('DESKTOP_DEVICE_VERSION_STALE');
    return Object.freeze({
      deviceId: text(revoked.deviceId, 'DESKTOP_DEVICE_REVOCATION_FAILED', 128),
      status: text(revoked.status, 'DESKTOP_DEVICE_REVOCATION_FAILED', 32),
      rowVersion: version(revoked.rowVersion, 'DESKTOP_DEVICE_REVOCATION_FAILED'),
      revokedAt: instant(revoked.revokedAt, 'DESKTOP_DEVICE_REVOCATION_FAILED'),
    });
  }

  return Object.freeze({ startChallenge, exchangeChallenge, switchRole, listDevices, revokeDevice });
}

module.exports = Object.freeze({
  CHALLENGE_TTL_MS,
  SESSION_TTL_MS,
  createCloudDesktopIdentityService,
  desktopRoleElevationSigningPayload,
  desktopSessionChallengeSigningPayload,
});
