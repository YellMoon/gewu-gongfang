'use strict';

const crypto = require('crypto');
const { types } = require('util');
const { normalizeMainlandPhone } = require('./mainlandPhone');

function failure(code = 'CLOUD_ONLINE_IDENTITY_INVALID') {
  return Object.assign(new Error('cloud online identity is invalid'), { code });
}

function rejected() {
  return Object.assign(new Error('cloud online identity was rejected'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw failure();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw failure();
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 8192 ? value : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacPhone(pepper, phone) {
  const mainlandPhone = normalizeMainlandPhone(phone);
  if (!mainlandPhone) throw failure();
  if (typeof pepper !== 'string' || pepper.length < 24) throw failure();
  return crypto.createHmac('sha256', pepper).update(`phone:${mainlandPhone}`, 'utf8').digest('hex');
}

function createOperatorPhoneLookup({ pepper, records }) {
  if (!Array.isArray(records) || records.length === 0) throw failure();
  const lookup = new Map();
  for (const raw of records) {
    const row = exact(raw, ['phoneHmac', 'authorityId', 'accountId']);
    if (!/^[0-9a-f]{64}$/u.test(row.phoneHmac) || !text(row.authorityId) || !text(row.accountId)) throw failure();
    if (lookup.has(row.phoneHmac)) throw failure();
    lookup.set(row.phoneHmac, Object.freeze({ authorityId: row.authorityId, accountId: row.accountId, phoneHmac: row.phoneHmac }));
  }
  return Object.freeze(phone => lookup.get(hmacPhone(pepper, phone)) || null);
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPart(secret, value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('base64url');
}

function makeTicket(secret, payload) {
  const encoded = base64urlJson(payload);
  return `${encoded}.${signPart(secret, encoded)}`;
}

function signedTicketPayload(secret, token) {
  if (typeof token !== 'string' || token.length > 4096) throw rejected();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw rejected();
  const expected = signPart(secret, parts[0]);
  const supplied = Buffer.from(parts[1]);
  const computed = Buffer.from(expected);
  if (supplied.length !== computed.length || !crypto.timingSafeEqual(supplied, computed)) throw rejected();
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (_) {
    throw rejected();
  }
  return payload;
}

function inspectTicket(secret, token, now) {
  const payload = signedTicketPayload(secret, token);
  const copy = exact(payload, ['v', 'authorityId', 'accountId', 'phoneHmac', 'challenge', 'proofId', 'expiresAt']);
  if (copy.v !== 1 || !text(copy.authorityId) || !text(copy.accountId)
    || !(copy.phoneHmac === null || /^[0-9a-f]{64}$/u.test(copy.phoneHmac))
    || !text(copy.challenge) || !text(copy.proofId) || !Number.isSafeInteger(copy.expiresAt) || copy.expiresAt <= now.getTime()) throw rejected();
  return Object.freeze(copy);
}

function inspectSessionTicket(secret, token, now) {
  const payload = signedTicketPayload(secret, token);
  const keys = payload?.v === 2
    ? ['v', 'authorityId', 'accountId', 'deviceId', 'installationId', 'sessionId', 'activeRole', 'expiresAt']
    : ['v', 'authorityId', 'accountId', 'deviceId', 'installationId', 'sessionId', 'expiresAt'];
  const copy = exact(payload, keys);
  if (![1, 2].includes(copy.v) || !text(copy.authorityId) || !text(copy.accountId) || !text(copy.deviceId)
    || !text(copy.installationId) || !text(copy.sessionId) || !Number.isSafeInteger(copy.expiresAt)
    || copy.expiresAt <= now.getTime()) throw rejected();
  if (copy.v === 2 && !['super_admin', 'teacher'].includes(copy.activeRole)) throw rejected();
  return Object.freeze(copy);
}

function sessionContext(value, ticket) {
  const copy = exact(value, ['authorityId', 'accountId', 'deviceId', 'installationId', 'sessionId', 'expiresAt', 'rowVersion', 'roles', 'teacherId', 'studentId']);
  if (copy.authorityId !== ticket.authorityId || copy.accountId !== ticket.accountId
    || copy.deviceId !== ticket.deviceId || copy.installationId !== ticket.installationId
    || copy.sessionId !== ticket.sessionId || copy.expiresAt !== new Date(ticket.expiresAt).toISOString()
    || !Array.isArray(copy.roles) || copy.roles.length > 2
    || copy.roles.some(role => !['super_admin', 'teacher'].includes(role))
    || new Set(copy.roles).size !== copy.roles.length
    || (copy.teacherId !== null && !text(copy.teacherId))
    || (copy.studentId !== null && !text(copy.studentId))
    || !Number.isSafeInteger(Number(copy.rowVersion)) || Number(copy.rowVersion) < 1) throw rejected();
  if (copy.roles.length === 0) throw failure('CLOUD_DESKTOP_TEACHER_REGISTRATION_REQUIRED');
  const activeRole = ticket.v === 2 ? ticket.activeRole : preferredLeaseRole(copy.roles);
  if (!activeRole || !copy.roles.includes(activeRole)) throw rejected();
  return Object.freeze({ ...copy, rowVersion: Number(copy.rowVersion), activeRole, roles: Object.freeze(copy.roles.slice()) });
}

function preferredLeaseRole(roles) {
  if (roles.includes('teacher')) return 'teacher';
  if (roles.includes('super_admin')) return 'super_admin';
  return null;
}

function offlineLease(leasePrivateKey, ticket, context, issuedAt) {
  const activeRole = context.activeRole || preferredLeaseRole(context.roles);
  if (!activeRole) throw rejected();
  const scope = { kind: activeRole };
  if (activeRole === 'teacher' && !context.teacherId) throw rejected();
  if (activeRole === 'teacher') scope.teacherId = context.teacherId;
  const lease = {
    v: 1,
    id: `offline-lease-${ticket.sessionId}`,
    userId: ticket.accountId,
    deviceId: ticket.deviceId,
    authorizationId: ticket.sessionId,
    credentialVersion: 1,
    eligibleRoles: Object.freeze(context.roles.slice()),
    activeRole,
    teacherId: activeRole === 'teacher' ? context.teacherId : null,
    studentId: null,
    issuedAt: issuedAt.toISOString(),
    expiresAt: context.expiresAt,
    scope: Object.freeze(scope),
  };
  return Object.freeze({
    ...lease,
    signature: crypto.sign(null, Buffer.from(JSON.stringify(lease), 'utf8'), leasePrivateKey).toString('base64url'),
  });
}

function verifyProof(publicKey, challenge, proof) {
  if (!text(publicKey) || !text(proof)) throw rejected();
  try {
    return crypto.verify(null, Buffer.from(challenge, 'utf8'), crypto.createPublicKey(publicKey), Buffer.from(proof, 'base64url'));
  } catch (_) {
    return false;
  }
}

function installationKeyFingerprint(publicKey) {
  try {
    return crypto.createHash('sha256')
      .update(crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' }))
      .digest('hex');
  } catch (_) {
    throw rejected();
  }
}

function opaqueId(secret, kind, value) {
  return `${kind}-${crypto.createHmac('sha256', secret).update(`${kind}:${value}`, 'utf8').digest('hex').slice(0, 32)}`;
}

function createCloudDesktopRegistrationService(config) {
  const settings = exact(config, ['now', 'randomId', 'phoneVerifier', 'lookupAccount', 'ticketSecret', 'leasePrivateKey', 'issueAssertion', 'register', 'readSessionContext']);
  if (typeof settings.now !== 'function' || typeof settings.randomId !== 'function' || typeof settings.phoneVerifier !== 'function'
    || typeof settings.lookupAccount !== 'function' || typeof settings.issueAssertion !== 'function' || typeof settings.register !== 'function' || typeof settings.readSessionContext !== 'function'
    || !settings.leasePrivateKey || settings.leasePrivateKey.type !== 'private' || settings.leasePrivateKey.asymmetricKeyType !== 'ed25519'
    || typeof settings.ticketSecret !== 'string' || settings.ticketSecret.length < 24) throw failure();
  const currentNow = () => {
    const value = settings.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw failure();
    return value;
  };
  const inspectVerificationToken = token => inspectTicket(settings.ticketSecret, token, currentNow());
  const inspectSessionToken = token => inspectSessionTicket(settings.ticketSecret, token, currentNow());
  const issueVerificationForVerifiedAccount = input => {
    let identity;
    try {
      identity = exact(input, ['authorityId', 'accountId', 'phoneHmac']);
    } catch (_) {
      throw rejected();
    }
    if (!text(identity.authorityId) || !text(identity.accountId)
      || !(identity.phoneHmac === null || /^[0-9a-f]{64}$/u.test(identity.phoneHmac))) throw rejected();
    const now = currentNow();
    const deviceChallenge = String(settings.randomId('desktop-proof-challenge'));
    return Object.freeze({
      verificationToken: makeTicket(settings.ticketSecret, {
        v: 1,
        authorityId: identity.authorityId,
        accountId: identity.accountId,
        phoneHmac: identity.phoneHmac,
        challenge: deviceChallenge,
        proofId: String(settings.randomId('online-identity-proof')),
        expiresAt: now.getTime() + 5 * 60 * 1000,
      }),
      deviceChallenge,
    });
  };
  const readCurrentSession = async ticket => {
    let current;
    try {
      current = await settings.readSessionContext({
        authorityId: ticket.authorityId,
        accountId: ticket.accountId,
        deviceId: ticket.deviceId,
        installationId: ticket.installationId,
        sessionId: ticket.sessionId,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
      });
    } catch (_) {
      throw rejected();
    }
    return sessionContext(current, ticket);
  };
  const issueSession = async input => {
    let request;
    try {
      request = exact(input, ['authorityId', 'accountId', 'deviceId', 'installationId', 'sessionId', 'expiresAt', 'rowVersion', 'activeRole']);
    } catch (_) {
      throw rejected();
    }
    const expiresAt = new Date(request.expiresAt);
    if (!text(request.authorityId) || !text(request.accountId) || !text(request.deviceId)
      || !text(request.installationId) || !text(request.sessionId)
      || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= currentNow().getTime()
      || !Number.isSafeInteger(Number(request.rowVersion)) || Number(request.rowVersion) < 1
      || !(request.activeRole === null || ['super_admin', 'teacher'].includes(request.activeRole))) throw rejected();
    const baseTicket = {
      v: 1,
      authorityId: request.authorityId,
      accountId: request.accountId,
      deviceId: request.deviceId,
      installationId: request.installationId,
      sessionId: request.sessionId,
      expiresAt: expiresAt.getTime(),
    };
    let token = makeTicket(settings.ticketSecret, baseTicket);
    let ticket = inspectSessionToken(token);
    let current = await readCurrentSession(ticket);
    const selectedRole = request.activeRole || preferredLeaseRole(current.roles);
    if (!selectedRole || !current.roles.includes(selectedRole)) throw rejected();
    token = makeTicket(settings.ticketSecret, { ...baseTicket, v: 2, activeRole: selectedRole });
    ticket = inspectSessionToken(token);
    current = await readCurrentSession(ticket);
    if (Number(current.rowVersion) !== Number(request.rowVersion)) throw rejected();
    const session = Object.freeze({
      id: current.sessionId,
      userId: current.accountId,
      deviceId: current.deviceId,
      activeRole: selectedRole,
      eligibleRoles: current.roles,
      teacherId: selectedRole === 'teacher' ? current.teacherId : null,
      studentId: null,
      expiresAt: current.expiresAt,
      rowVersion: current.rowVersion,
    });
    const profile = Object.freeze({
      userId: current.accountId,
      user: Object.freeze({ id: current.accountId, name: 'Cloud account' }),
      eligibleRoles: current.roles,
      activeRole: selectedRole,
      teacherId: session.teacherId,
      studentId: null,
    });
    return Object.freeze({
      token,
      session,
      profile,
      offlineLease: offlineLease(settings.leasePrivateKey, ticket, current, currentNow()),
    });
  };
  return Object.freeze({
    inspectVerificationToken,
    inspectSessionToken,
    issueVerificationForVerifiedAccount,
    issueSession,
    async begin(input) {
      const request = exact(input, ['phoneCode']);
      if (!text(request.phoneCode)) throw rejected();
      let phone;
      try {
        phone = normalizeMainlandPhone(await settings.phoneVerifier(request.phoneCode));
        if (!phone) throw rejected();
      } catch (_) {
        throw rejected();
      }
      let identity;
      try {
        identity = await settings.lookupAccount(phone);
      } catch (_) {
        throw rejected();
      }
      return issueVerificationForVerifiedAccount(identity);
    },
    async register(input) {
      const request = exact(input, ['verificationToken', 'installationId', 'installationPublicKey', 'deviceProof', 'idempotencyKey']);
      if (!text(request.installationId) || typeof request.installationPublicKey !== 'string' || request.installationPublicKey.trim() === '' || request.installationPublicKey.length > 8192 || !text(request.deviceProof) || !text(request.idempotencyKey)) throw rejected();
      const ticket = inspectVerificationToken(request.verificationToken);
      const installationPublicKey = request.installationPublicKey.trim();
      if (!verifyProof(installationPublicKey, ticket.challenge, request.deviceProof)) throw rejected();
      const now = currentNow();
      const keyFingerprint = installationKeyFingerprint(installationPublicKey);
      const deviceId = `desktop-device-${keyFingerprint.slice(0, 32)}`;
      const canonicalRequestSha256 = sha256(JSON.stringify({ authorityId: ticket.authorityId, accountId: ticket.accountId, deviceId, installationId: request.installationId, keyFingerprint, idempotencyKey: request.idempotencyKey }));
      const assertionId = opaqueId(settings.ticketSecret, 'assertion', `${ticket.proofId}:${request.installationId}`);
      const linkId = opaqueId(settings.ticketSecret, 'link', `${ticket.authorityId}:${ticket.accountId}:${request.installationId}`);
      const receiptId = opaqueId(settings.ticketSecret, 'receipt', `${ticket.authorityId}:${ticket.accountId}:${request.idempotencyKey}:${keyFingerprint}`);
      const auditEventId = opaqueId(settings.ticketSecret, 'audit', receiptId);
      const outboxEventId = opaqueId(settings.ticketSecret, 'outbox', receiptId);
      const sessionId = opaqueId(settings.ticketSecret, 'session', `${ticket.authorityId}:${ticket.accountId}:${request.idempotencyKey}:${keyFingerprint}`);
      const issuedAt = now.toISOString();
      const assertionExpiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      const sessionExpiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const canonicalResultJson = JSON.stringify({ sessionId });
      const issue = {
        assertionId, authorityId: ticket.authorityId, accountId: ticket.accountId, deviceId, installationId: request.installationId,
        installationPublicKey, keyFingerprint, audience: 'unified-desktop', nonceSha256: sha256(ticket.proofId),
        canonicalRequestSha256, identityProofSha256: sha256(request.verificationToken), hardwareEvidenceSha256: keyFingerprint, issuedAt, expiresAt: assertionExpiresAt,
      };
      try {
        await settings.issueAssertion(issue);
        const result = await settings.register({
          assertionId, idempotencyKey: request.idempotencyKey, receiptId, auditEventId, outboxEventId, sessionId, linkId, sessionExpiresAt,
          canonicalRequestSha256, canonicalResultJson, resultSha256: sha256(canonicalResultJson), canonicalPayloadJson: canonicalResultJson, payloadSha256: sha256(canonicalResultJson),
        });
        if (!result || result.receiptId !== receiptId || !text(result.sessionId) || typeof result.replayed !== 'boolean') throw rejected();
        const sessionToken = makeTicket(settings.ticketSecret, {
          v: 1,
          authorityId: ticket.authorityId,
          accountId: ticket.accountId,
          deviceId,
          installationId: request.installationId,
          sessionId: result.sessionId,
          expiresAt: new Date(sessionExpiresAt).getTime(),
        });
        const current = await readCurrentSession(inspectSessionToken(sessionToken));
        return Object.freeze({
          receiptId,
          sessionId: result.sessionId,
          replayed: result.replayed,
          sessionToken,
          offlineLease: offlineLease(settings.leasePrivateKey, inspectSessionToken(sessionToken), current, now),
        });
      } catch (error) {
        if (error && ['CLOUD_ONLINE_IDENTITY_REJECTED', 'CLOUD_DESKTOP_TEACHER_REGISTRATION_REQUIRED'].includes(error.code)) throw error;
        throw rejected();
      }
    },
    async sessionContext(input) {
      const request = exact(input, ['sessionToken']);
      const ticket = inspectSessionToken(request.sessionToken);
      return readCurrentSession(ticket);
    },
  });
}

module.exports = Object.freeze({ createCloudDesktopRegistrationService, createOperatorPhoneLookup, hmacPhone });
