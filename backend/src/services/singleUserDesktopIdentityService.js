'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  CANONICAL_SUPER_ADMIN_ID,
  SUPER_ADMIN_PHONE,
  normalizePhone,
} = require('./authorizationPolicy');
const { insertPrimaryHostEpochRow } = require('./primaryHostIdentityService');
const pairingProtocol = require('../../../public/singleUserPairingEnvelope');

const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const serviceByDatabase = new WeakMap();

function identityError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requiredText(value, code, maxLength = 256) {
  if (typeof value !== 'string') throw identityError(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw identityError(code);
  return normalized;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fingerprintPublicKey(publicKey, code = 'DESKTOP_SINGLE_USER_PUBLIC_KEY_INVALID') {
  try {
    const parsed = crypto.createPublicKey(publicKey);
    if (parsed.asymmetricKeyType !== 'ed25519') throw identityError(code);
    return {
      publicKey: parsed.export({ type: 'spki', format: 'pem' }).toString().trim(),
      fingerprint: sha256(parsed.export({ type: 'spki', format: 'der' })),
    };
  } catch (error) {
    if (error?.code === code) throw error;
    throw identityError(code, error);
  }
}

function crockfordBase32(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 10) {
    throw identityError('DESKTOP_PAIRING_RANDOM_INVALID');
  }
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD_ALPHABET[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits !== 0 || output.length !== 16) throw identityError('DESKTOP_PAIRING_RANDOM_INVALID');
  return output;
}

function presentAuthorization(row) {
  return Object.freeze({
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceKind: row.device_kind,
    userId: row.user_id,
    publicKey: row.public_key,
    keyFingerprint: row.key_fingerprint,
    status: row.status,
    authorizationSource: row.authorization_source,
    credentialVersion: Number(row.credential_version),
    rowVersion: Number(row.row_version),
  });
}

function presentEpoch(row) {
  return Object.freeze({
    id: row.id,
    generation: Number(row.generation),
    deviceId: row.device_id,
    userId: row.user_id,
    authorizationId: row.authorization_id,
    status: row.status,
    credentialVersion: Number(row.credential_version),
  });
}

function createSingleUserDesktopIdentityService({
  db,
  now = () => new Date(),
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
  identityMode = () => process.env.GEWU_DESKTOP_IDENTITY_MODE || 'full',
  runtimeContext = () => ({
    deviceId: process.env.GEWU_DEVICE_ID || '',
    nodeRole: process.env.GEWU_NODE_ROLE || 'desktop-client',
    epochId: process.env.GEWU_PRIMARY_HOST_EPOCH_ID || null,
    generation: process.env.GEWU_PRIMARY_HOST_GENERATION || null,
  }),
  localValidationService,
  protocol = pairingProtocol,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw identityError('DESKTOP_SINGLE_USER_DB_REQUIRED');
  }
  if (!localValidationService || typeof localValidationService.prepare !== 'function') {
    throw identityError('DESKTOP_SINGLE_USER_LOCAL_VALIDATION_REQUIRED');
  }

  let capabilityState = null;
  const findActiveEpoch = db.prepare(
    "SELECT * FROM primary_host_epochs WHERE status='active' ORDER BY generation DESC LIMIT 1"
  );
  const findAuthorizationByDevice = db.prepare(
    'SELECT * FROM desktop_device_authorizations WHERE device_id=?'
  );

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw identityError('DESKTOP_SINGLE_USER_CLOCK_INVALID');
    return date;
  }

  function assertModeActive() {
    if (identityMode() !== 'single-user') throw identityError('DESKTOP_SINGLE_USER_MODE_DISABLED');
  }

  function canonicalOwner() {
    const user = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0').get(CANONICAL_SUPER_ADMIN_ID);
    const grant = user && db.prepare(`SELECT 1 FROM user_role_grants
      WHERE user_id=? AND role='super_admin' AND status='active'`).get(user.id);
    if (!user || !grant || user.status === 0 || user.login_enabled === 0
      || user.review_status !== 'approved' || user.is_super_admin_identity !== 1
      || normalizePhone(user.phone) !== normalizePhone(SUPER_ADMIN_PHONE)) {
      throw identityError('DESKTOP_SINGLE_USER_CANONICAL_OWNER_REQUIRED');
    }
    return user;
  }

  function normalizePublicIdentity(value, expectedKind) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw identityError('DESKTOP_SINGLE_USER_PUBLIC_IDENTITY_REQUIRED');
    }
    const deviceId = requiredText(value.deviceId, 'DESKTOP_SINGLE_USER_DEVICE_ID_INVALID', 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)) {
      throw identityError('DESKTOP_SINGLE_USER_DEVICE_ID_INVALID');
    }
    const deviceName = requiredText(value.deviceName, 'DESKTOP_SINGLE_USER_DEVICE_NAME_INVALID', 128);
    if (value.deviceKind !== expectedKind) throw identityError('DESKTOP_SINGLE_USER_DEVICE_KIND_INVALID');
    const key = fingerprintPublicKey(
      requiredText(value.publicKey, 'DESKTOP_SINGLE_USER_PUBLIC_KEY_INVALID', 4096)
    );
    return Object.freeze({ deviceId, deviceName, deviceKind: expectedKind, ...key });
  }

  function configuredRuntime(input, { activeEpoch = null, allowUnboundEpoch = false } = {}) {
    const configured = runtimeContext() || {};
    const supplied = input || {};
    const configuredDeviceId = requiredText(
      configured.deviceId,
      'DESKTOP_SINGLE_USER_RUNTIME_MISMATCH',
      128
    );
    if (configured.nodeRole !== 'primary-host' || supplied.nodeRole !== 'primary-host'
      || supplied.deviceId !== configuredDeviceId) {
      throw identityError('DESKTOP_SINGLE_USER_RUNTIME_MISMATCH');
    }
    if (activeEpoch && !allowUnboundEpoch) {
      if (configured.epochId !== activeEpoch.id || supplied.epochId !== activeEpoch.id
        || Number(configured.generation) !== Number(activeEpoch.generation)
        || Number(supplied.generation) !== Number(activeEpoch.generation)) {
        throw identityError('DESKTOP_SINGLE_USER_RUNTIME_MISMATCH');
      }
    }
    return Object.freeze({ ...configured, deviceId: configuredDeviceId });
  }

  function insertAudit({ actorUserId, targetUserId = actorUserId, action, before = null, after = null, at }) {
    db.prepare(`INSERT INTO authorization_audit_log
      (id,actor_user_id,target_user_id,action,before_json,after_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      uuid(), actorUserId || null, targetUserId || null, action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      at
    );
  }

  function actorFor(user, authorization, epoch) {
    return Object.freeze({
      userId: user.id,
      deviceId: authorization.device_id,
      authorizationId: authorization.id,
      credentialVersion: Number(authorization.credential_version),
      activeRole: 'super_admin',
      eligibleRoles: Object.freeze(['super_admin']),
      epochId: epoch.id,
      generation: Number(epoch.generation),
    });
  }

  function assertHostActor(actor, runtime) {
    assertModeActive();
    const active = findActiveEpoch.get();
    if (!active) throw identityError('DESKTOP_SINGLE_USER_HOST_NOT_BOOTSTRAPPED');
    configuredRuntime(runtime, { activeEpoch: active });
    const user = canonicalOwner();
    const authorization = findAuthorizationByDevice.get(active.device_id);
    if (!actor || actor.userId !== user.id || actor.deviceId !== active.device_id
      || actor.authorizationId !== active.authorization_id || actor.epochId !== active.id
      || Number(actor.generation) !== Number(active.generation)
      || actor.activeRole !== 'super_admin' || !actor.eligibleRoles?.includes('super_admin')
      || !authorization || authorization.status !== 'active'
      || authorization.authorization_source !== 'single_user_local_bootstrap'
      || authorization.device_kind !== 'primary-host'
      || Number(actor.credentialVersion) !== Number(authorization.credential_version)) {
      throw identityError('DESKTOP_SINGLE_USER_HOST_ACTOR_INVALID');
    }
    return { active, user, authorization };
  }

  function assertValidation(result) {
    const evidence = result?.evidence || {};
    const backup = result?.localValidation?.backup || {};
    if (evidence.runtimeNodeRole !== 'primary-host') {
      throw identityError('PRIMARY_HOST_RUNTIME_ROLE_REQUIRED');
    }
    if (evidence.quickCheck !== 'ok') throw identityError('PRIMARY_HOST_SQLITE_QUICK_CHECK_FAILED');
    if (!/^[a-f0-9]{64}$/i.test(String(evidence.dbInstanceDigest || ''))
      || !Number.isSafeInteger(Number(evidence.schemaVersion)) || Number(evidence.schemaVersion) < 1) {
      throw identityError('PRIMARY_HOST_LOCAL_EVIDENCE_INVALID');
    }
    if (!String(evidence.storeId || '').trim() || !String(evidence.dbAuthorityId || '').trim()) {
      throw identityError('PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED');
    }
    if (backup.authoritative !== true || backup.quickCheck !== 'ok'
      || !/^[a-f0-9]{64}$/i.test(String(backup.sha256 || ''))
      || Number(backup.schemaVersion) !== Number(evidence.schemaVersion)
      || backup.storeId !== evidence.storeId || backup.dbAuthorityId !== evidence.dbAuthorityId) {
      throw identityError('PRIMARY_HOST_LOCAL_BACKUP_INVALID');
    }
    return { evidence, backup };
  }

  async function bootstrapLocalHost(input = {}) {
    assertModeActive();
    if (input.localBridgeVerified !== true) {
      throw identityError('DESKTOP_SINGLE_USER_LOCAL_BRIDGE_REQUIRED');
    }
    if (input.buildFlavor !== 'primary-host') {
      throw identityError('DESKTOP_SINGLE_USER_HOST_BUILD_REQUIRED');
    }
    if (input.confirmation !== 'SET_LOCAL_PASSWORD_CONFIRMED') {
      throw identityError('DESKTOP_SINGLE_USER_CONFIRMATION_REQUIRED');
    }
    const publicIdentity = normalizePublicIdentity(input.publicIdentity, 'primary-host');
    const activeBefore = findActiveEpoch.get() || null;
    const runtime = configuredRuntime(input.runtime, {
      activeEpoch: activeBefore,
      allowUnboundEpoch: !activeBefore,
    });
    if (publicIdentity.deviceId !== runtime.deviceId) {
      throw identityError('DESKTOP_SINGLE_USER_RUNTIME_MISMATCH');
    }
    const user = canonicalOwner();
    if (activeBefore && (activeBefore.device_id !== runtime.deviceId || activeBefore.user_id !== user.id)) {
      throw identityError('DESKTOP_SINGLE_USER_HOST_ALREADY_BOUND');
    }
    const validation = assertValidation(await localValidationService.prepare({
      operation: 'bootstrap',
      deviceId: runtime.deviceId,
      actorContext: activeBefore ? {
        userId: user.id,
        deviceId: runtime.deviceId,
        authorizationId: activeBefore.authorization_id,
        activeRole: 'super_admin',
        eligibleRoles: ['super_admin'],
      } : undefined,
    }));
    const timestamp = currentDate().toISOString();
    const result = db.transaction(() => {
      const liveQuickCheck = typeof db.pragma === 'function'
        ? String(db.pragma('quick_check', { simple: true }) || '')
        : '';
      if (liveQuickCheck !== 'ok') throw identityError('PRIMARY_HOST_SQLITE_QUICK_CHECK_FAILED');
      const liveAuthority = db.prepare(
        "SELECT value FROM authority_metadata WHERE key='database_authority_id'"
      ).get();
      const liveBinding = db.prepare(`SELECT store_id,db_authority_id
        FROM question_bank_store_bindings WHERE status='active' ORDER BY rowid DESC LIMIT 1`).get();
      if (!liveAuthority || !liveBinding
        || liveAuthority.value !== validation.evidence.dbAuthorityId
        || liveBinding.db_authority_id !== validation.evidence.dbAuthorityId
        || liveBinding.store_id !== validation.evidence.storeId) {
        throw identityError('PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED');
      }
      const active = findActiveEpoch.get() || null;
      if (active && (active.device_id !== runtime.deviceId || active.user_id !== user.id)) {
        throw identityError('DESKTOP_SINGLE_USER_HOST_ALREADY_BOUND');
      }
      let authorization = findAuthorizationByDevice.get(runtime.deviceId);
      if (authorization && authorization.user_id !== user.id) {
        throw identityError('DESKTOP_SINGLE_USER_DEVICE_OWNER_MISMATCH');
      }
      if (authorization && authorization.public_key.trim() !== publicIdentity.publicKey) {
        throw identityError('DESKTOP_SINGLE_USER_CREDENTIAL_RESET_REQUIRED');
      }
      const fingerprintOwner = db.prepare(
        'SELECT device_id FROM desktop_device_authorizations WHERE key_fingerprint=?'
      ).get(publicIdentity.fingerprint);
      if (fingerprintOwner && fingerprintOwner.device_id !== runtime.deviceId) {
        throw identityError('DESKTOP_SINGLE_USER_KEY_ALREADY_BOUND');
      }
      const authorizationId = authorization?.id || uuid();
      const sourceChallengeId = authorization?.source_challenge_id || `single-user-bootstrap:${uuid()}`;
      if (!authorization) {
        db.prepare(`INSERT INTO desktop_device_authorizations
          (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,
           source_challenge_id,authorization_source,approved_by_user_id,approved_by_device_id,
           approved_at,last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,
           created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'active',?,'single_user_local_bootstrap',?,?,?,?,?,1,1,?,?)`)
          .run(
            authorizationId, runtime.deviceId, publicIdentity.deviceName, 'primary-host', user.id,
            publicIdentity.publicKey, publicIdentity.fingerprint, sourceChallengeId,
            user.id, runtime.deviceId, timestamp, timestamp, timestamp, timestamp, timestamp
          );
      } else {
        db.prepare(`UPDATE desktop_device_authorizations
          SET device_name=?,device_kind='primary-host',status='active',
              authorization_source='single_user_local_bootstrap',approved_by_user_id=?,
              approved_by_device_id=?,approved_at=?,revoked_at=NULL,retired_at=NULL,
              row_version=row_version+1,updated_at=? WHERE id=?`)
          .run(publicIdentity.deviceName, user.id, runtime.deviceId, timestamp, timestamp, authorization.id);
      }
      authorization = db.prepare('SELECT * FROM desktop_device_authorizations WHERE id=?').get(authorizationId);
      let epoch = active;
      if (!epoch) {
        const challengeId = uuid();
        const expiresAt = new Date(Date.parse(timestamp) + PAIRING_TTL_MS).toISOString();
        db.prepare(`INSERT INTO primary_host_operation_challenges
          (id,operation,requested_by_user_id,requested_by_device_id,target_device_id,status,
           verified_user_id,phone_verified_at,expires_at,row_version,created_at,updated_at,consumed_at)
          VALUES (?,'bootstrap',?,?,?,'consumed',?,?,?,1,?,?,?)`)
          .run(challengeId, user.id, runtime.deviceId, runtime.deviceId, user.id,
            timestamp, expiresAt, timestamp, timestamp, timestamp);
        const epochId = uuid();
        epoch = insertPrimaryHostEpochRow({
          db,
          id: epochId,
          generation: 1,
          deviceId: runtime.deviceId,
          userId: user.id,
          authorizationId: authorization.id,
          activationReason: 'bootstrap',
          challengeId,
          dbInstanceDigest: validation.evidence.dbInstanceDigest,
          schemaVersion: Number(validation.evidence.schemaVersion),
          storeId: validation.evidence.storeId,
          dbAuthorityId: validation.evidence.dbAuthorityId,
          credentialHash: sha256(publicIdentity.publicKey),
          timestamp,
        });
      }
      insertAudit({
        actorUserId: user.id,
        action: active ? 'desktop_single_user_local_authorization_refreshed' : 'desktop_single_user_local_bootstrapped',
        after: {
          deviceId: runtime.deviceId,
          authorizationId: authorization.id,
          epochId: epoch.id,
          generation: Number(epoch.generation),
          backupSha256: validation.backup.sha256,
        },
        at: timestamp,
      });
      return { authorization, epoch };
    })();
    return Object.freeze({
      authorization: presentAuthorization(result.authorization),
      epoch: presentEpoch(result.epoch),
      actor: actorFor(user, result.authorization, result.epoch),
      backup: Object.freeze({ ...validation.backup }),
    });
  }

  function resetLocalHostCredential(input = {}) {
    if (input.confirmation !== 'RESET_LOCAL_PASSWORD_CONFIRMED') {
      throw identityError('DESKTOP_SINGLE_USER_RESET_CONFIRMATION_REQUIRED');
    }
    const context = assertHostActor(input.actor, input.runtime);
    const publicIdentity = normalizePublicIdentity(input.publicIdentity, 'primary-host');
    if (publicIdentity.deviceId !== context.active.device_id) {
      throw identityError('DESKTOP_SINGLE_USER_RUNTIME_MISMATCH');
    }
    const fingerprintOwner = db.prepare(
      'SELECT device_id FROM desktop_device_authorizations WHERE key_fingerprint=?'
    ).get(publicIdentity.fingerprint);
    if (fingerprintOwner && fingerprintOwner.device_id !== publicIdentity.deviceId) {
      throw identityError('DESKTOP_SINGLE_USER_KEY_ALREADY_BOUND');
    }
    const timestamp = currentDate().toISOString();
    const updated = db.transaction(() => {
      db.prepare(`UPDATE desktop_device_authorizations
        SET device_name=?,public_key=?,key_fingerprint=?,credential_version=credential_version+1,
            row_version=row_version+1,updated_at=? WHERE id=? AND status='active'`)
        .run(publicIdentity.deviceName, publicIdentity.publicKey, publicIdentity.fingerprint,
          timestamp, context.authorization.id);
      db.prepare(`UPDATE primary_host_epochs
        SET host_credential_hash=?,credential_version=credential_version+1,
            row_version=row_version+1,updated_at=? WHERE id=? AND status='active'`)
        .run(sha256(publicIdentity.publicKey), timestamp, context.active.id);
      db.prepare(`UPDATE desktop_sessions SET status='revoked',revoke_reason='credential_reset',
        revoked_at=?,row_version=row_version+1,updated_at=?
        WHERE authorization_id=? AND status='active'`)
        .run(timestamp, timestamp, context.authorization.id);
      const authorization = db.prepare('SELECT * FROM desktop_device_authorizations WHERE id=?')
        .get(context.authorization.id);
      const epoch = db.prepare('SELECT * FROM primary_host_epochs WHERE id=?').get(context.active.id);
      insertAudit({
        actorUserId: context.user.id,
        action: 'desktop_single_user_local_credential_reset',
        before: { credentialVersion: Number(context.authorization.credential_version) },
        after: { credentialVersion: Number(authorization.credential_version) },
        at: timestamp,
      });
      return { authorization, epoch };
    })();
    capabilityState = null;
    return Object.freeze({
      authorization: presentAuthorization(updated.authorization),
      epoch: presentEpoch(updated.epoch),
      actor: actorFor(context.user, updated.authorization, updated.epoch),
    });
  }

  function issuePairingGrant(input = {}) {
    const context = assertHostActor(input.actor, input.runtime);
    const current = currentDate();
    const timestamp = current.toISOString();
    const code = crockfordBase32(randomBytes(10));
    const salt = randomBytes(16);
    const digest = crypto.scryptSync(code, salt, 32).toString('hex');
    capabilityState = protocol.createHostCapability({ now: () => current, ttlMs: PAIRING_TTL_MS });
    const id = uuid();
    const expiresAt = new Date(current.getTime() + PAIRING_TTL_MS).toISOString();
    db.transaction(() => {
      db.prepare(`UPDATE desktop_single_user_pairing_grants
        SET status='revoked',revoked_at=?,updated_at=? WHERE status='pending'`)
        .run(timestamp, timestamp);
      db.prepare(`INSERT INTO desktop_single_user_pairing_grants
        (id,owner_user_id,epoch_id,generation,capability_id,code_salt,code_digest,status,
         failed_attempts,max_attempts,expires_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'pending',0,?,?,?,?)`)
        .run(
          id, context.user.id, context.active.id, Number(context.active.generation),
          capabilityState.publicCapability.id, salt.toString('base64'), digest,
          MAX_PAIRING_ATTEMPTS, expiresAt, timestamp, timestamp
        );
      insertAudit({
        actorUserId: context.user.id,
        action: 'desktop_single_user_pairing_grant_issued',
        after: { grantId: id, capabilityId: capabilityState.publicCapability.id, expiresAt },
        at: timestamp,
      });
    })();
    salt.fill(0);
    return Object.freeze({
      id,
      code,
      expiresAt,
      capability: capabilityState.publicCapability,
    });
  }

  function currentPairingCapability() {
    assertModeActive();
    if (!capabilityState) throw identityError('DESKTOP_PAIRING_CAPABILITY_UNAVAILABLE');
    const grant = db.prepare(`SELECT 1 FROM desktop_single_user_pairing_grants
      WHERE capability_id=? AND status='pending' AND expires_at>?`)
      .get(capabilityState.publicCapability.id, currentDate().toISOString());
    if (!grant) throw identityError('DESKTOP_PAIRING_CAPABILITY_UNAVAILABLE');
    return capabilityState.publicCapability;
  }

  function consumeEncryptedPairingRequest(input = {}) {
    assertModeActive();
    if (!capabilityState) throw identityError('DESKTOP_PAIRING_CAPABILITY_UNAVAILABLE');
    const channel = input.channel === 'cloud' ? 'cloud' : input.channel === 'direct' ? 'direct' : null;
    if (!channel) throw identityError('DESKTOP_PAIRING_CHANNEL_INVALID');
    const opened = protocol.decryptPairingRequest({
      envelope: input.envelope,
      capabilityPrivateKey: capabilityState.privateKey,
      expectedCapabilityId: capabilityState.publicCapability.id,
      now: () => currentDate(),
    });
    if (opened.device.deviceKind !== 'desktop-client') {
      throw identityError('DESKTOP_PAIRING_DEVICE_KIND_INVALID');
    }
    const key = fingerprintPublicKey(opened.device.publicKey, 'DESKTOP_PAIRING_PUBLIC_KEY_INVALID');
    const envelopeHash = sha256(Buffer.from(JSON.stringify(input.envelope), 'utf8'));
    const current = currentDate();
    const timestamp = current.toISOString();
    const requestId = uuid();
    const outcome = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM desktop_single_user_pairing_requests WHERE envelope_hash=?').get(envelopeHash)) {
        return { error: 'DESKTOP_PAIRING_REQUEST_REPLAYED' };
      }
      const grant = db.prepare(`SELECT * FROM desktop_single_user_pairing_grants
        WHERE capability_id=? ORDER BY created_at DESC LIMIT 1`)
        .get(opened.capabilityId);
      if (!grant || grant.status !== 'pending') {
        return { error: grant?.status === 'locked'
          ? 'DESKTOP_PAIRING_GRANT_LOCKED'
          : 'DESKTOP_PAIRING_GRANT_UNAVAILABLE' };
      }
      const activeEpoch = findActiveEpoch.get();
      if (!activeEpoch || activeEpoch.id !== grant.epoch_id
        || Number(activeEpoch.generation) !== Number(grant.generation)
        || activeEpoch.user_id !== grant.owner_user_id) {
        db.prepare(`UPDATE desktop_single_user_pairing_grants
          SET status='revoked',revoked_at=?,updated_at=? WHERE id=? AND status='pending'`)
          .run(timestamp, timestamp, grant.id);
        return { error: 'DESKTOP_PAIRING_GRANT_UNAVAILABLE' };
      }
      if (Date.parse(grant.expires_at) <= current.getTime()) {
        db.prepare(`UPDATE desktop_single_user_pairing_grants
          SET status='expired',updated_at=? WHERE id=? AND status='pending'`)
          .run(timestamp, grant.id);
        return { error: 'DESKTOP_PAIRING_GRANT_EXPIRED' };
      }
      const actual = crypto.scryptSync(opened.pairingCode, Buffer.from(grant.code_salt, 'base64'), 32);
      const expected = Buffer.from(grant.code_digest, 'hex');
      const matches = expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
      actual.fill(0);
      if (!matches) {
        const failedAttempts = Number(grant.failed_attempts) + 1;
        const locked = failedAttempts >= Number(grant.max_attempts);
        db.prepare(`UPDATE desktop_single_user_pairing_grants
          SET failed_attempts=?,status=?,locked_at=?,updated_at=? WHERE id=? AND status='pending'`)
          .run(failedAttempts, locked ? 'locked' : 'pending', locked ? timestamp : null, timestamp, grant.id);
        db.prepare(`INSERT INTO desktop_single_user_pairing_requests
          (id,grant_id,channel,envelope_hash,device_id,device_name,public_key,key_fingerprint,
           status,error_code,created_at,updated_at,completed_at)
          VALUES (?,?,?,?,?,?,?,?,'rejected',?,?,?,?)`)
          .run(requestId, grant.id, channel, envelopeHash, opened.device.deviceId,
            opened.device.deviceName, key.publicKey, key.fingerprint,
            locked ? 'DESKTOP_PAIRING_GRANT_LOCKED' : 'DESKTOP_PAIRING_CODE_INVALID',
            timestamp, timestamp, timestamp);
        return { error: locked ? 'DESKTOP_PAIRING_GRANT_LOCKED' : 'DESKTOP_PAIRING_CODE_INVALID' };
      }
      const fingerprintOwner = db.prepare(
        'SELECT device_id FROM desktop_device_authorizations WHERE key_fingerprint=?'
      ).get(key.fingerprint);
      if (fingerprintOwner && fingerprintOwner.device_id !== opened.device.deviceId) {
        return { error: 'DESKTOP_PAIRING_KEY_ALREADY_BOUND' };
      }
      let authorization = findAuthorizationByDevice.get(opened.device.deviceId);
      if (authorization?.device_kind === 'primary-host') {
        return { error: 'DESKTOP_PAIRING_PRIMARY_HOST_FORBIDDEN' };
      }
      const authorizationId = authorization?.id || uuid();
      if (authorization) {
        db.prepare(`UPDATE desktop_device_authorizations
          SET device_name=?,device_kind='desktop-client',user_id=?,public_key=?,key_fingerprint=?,
              status='active',source_challenge_id=?,authorization_source='single_user_pairing',
              approved_by_user_id=?,approved_by_device_id=?,approved_at=?,
              last_phone_verified_at=?,phone_reverify_due_at=?,credential_version=credential_version+1,
              row_version=row_version+1,revoked_at=NULL,retired_at=NULL,updated_at=? WHERE id=?`)
          .run(opened.device.deviceName, grant.owner_user_id, key.publicKey, key.fingerprint,
            `single-user-pairing:${requestId}`, grant.owner_user_id,
            findActiveEpoch.get()?.device_id || null, timestamp, timestamp, timestamp,
            timestamp, authorization.id);
      } else {
        db.prepare(`INSERT INTO desktop_device_authorizations
          (id,device_id,device_name,device_kind,user_id,public_key,key_fingerprint,status,
           source_challenge_id,authorization_source,approved_by_user_id,approved_by_device_id,
           approved_at,last_phone_verified_at,phone_reverify_due_at,credential_version,row_version,
           created_at,updated_at)
          VALUES (?,?,?,'desktop-client',?,?,?,'active',?,'single_user_pairing',?,?,?,?,?,1,1,?,?)`)
          .run(authorizationId, opened.device.deviceId, opened.device.deviceName,
            grant.owner_user_id, key.publicKey, key.fingerprint, `single-user-pairing:${requestId}`,
            grant.owner_user_id, findActiveEpoch.get()?.device_id || null,
            timestamp, timestamp, timestamp, timestamp, timestamp);
      }
      authorization = db.prepare('SELECT * FROM desktop_device_authorizations WHERE id=?').get(authorizationId);
      db.prepare(`UPDATE desktop_single_user_pairing_grants
        SET status='consumed',consumed_at=?,updated_at=? WHERE id=? AND status='pending'`)
        .run(timestamp, timestamp, grant.id);
      db.prepare(`INSERT INTO desktop_single_user_pairing_requests
        (id,grant_id,channel,envelope_hash,device_id,device_name,public_key,key_fingerprint,
         status,authorization_id,created_at,updated_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,'authorized',?,?,?,?)`)
        .run(requestId, grant.id, channel, envelopeHash, opened.device.deviceId,
          opened.device.deviceName, key.publicKey, key.fingerprint,
          authorization.id, timestamp, timestamp, timestamp);
      insertAudit({
        actorUserId: grant.owner_user_id,
        action: 'desktop_single_user_pairing_authorized',
        after: { grantId: grant.id, requestId, authorizationId: authorization.id, deviceId: authorization.device_id },
        at: timestamp,
      });
      return { authorization, grantId: grant.id, requestId };
    })();
    if (outcome.error) throw identityError(outcome.error);
    return Object.freeze({
      grantId: outcome.grantId,
      requestId: outcome.requestId,
      authorization: presentAuthorization(outcome.authorization),
    });
  }

  function revokePairingGrant(input = {}) {
    const context = assertHostActor(input.actor, input.runtime);
    const grantId = requiredText(input.grantId, 'DESKTOP_PAIRING_GRANT_ID_REQUIRED');
    const timestamp = currentDate().toISOString();
    const changed = db.prepare(`UPDATE desktop_single_user_pairing_grants
      SET status='revoked',revoked_at=?,updated_at=?
      WHERE id=? AND owner_user_id=? AND status='pending'`)
      .run(timestamp, timestamp, grantId, context.user.id);
    if (changed.changes !== 1) throw identityError('DESKTOP_PAIRING_GRANT_UNAVAILABLE');
    if (capabilityState?.publicCapability.id === db.prepare(
      'SELECT capability_id FROM desktop_single_user_pairing_grants WHERE id=?'
    ).get(grantId)?.capability_id) capabilityState = null;
    return Object.freeze({ id: grantId, status: 'revoked' });
  }

  function disableSingleUserAuthorizations(input = {}) {
    const context = assertHostActor(input.actor, input.runtime);
    const timestamp = currentDate().toISOString();
    const result = db.transaction(() => {
      const authorizationIds = db.prepare(`SELECT id FROM desktop_device_authorizations
        WHERE authorization_source='single_user_pairing' AND status='active'`).all().map(row => row.id);
      const revoked = db.prepare(`UPDATE desktop_device_authorizations
        SET status='revoked',credential_version=credential_version+1,row_version=row_version+1,
            revoked_at=?,updated_at=?
        WHERE authorization_source='single_user_pairing' AND status='active'`)
        .run(timestamp, timestamp);
      let revokedSessions = 0;
      if (authorizationIds.length) {
        const placeholders = authorizationIds.map(() => '?').join(',');
        revokedSessions = db.prepare(`UPDATE desktop_sessions
          SET status='revoked',revoke_reason='single_user_mode_disabled',revoked_at=?,
              row_version=row_version+1,updated_at=?
          WHERE status='active' AND authorization_id IN (${placeholders})`)
          .run(timestamp, timestamp, ...authorizationIds).changes;
      }
      const revokedGrants = db.prepare(`UPDATE desktop_single_user_pairing_grants
        SET status='revoked',revoked_at=?,updated_at=? WHERE status='pending'`)
        .run(timestamp, timestamp).changes;
      const rejectedRequests = db.prepare(`UPDATE desktop_single_user_pairing_requests
        SET status='rejected',error_code='DESKTOP_SINGLE_USER_MODE_DISABLED',completed_at=?,updated_at=?
        WHERE status='pending'`)
        .run(timestamp, timestamp).changes;
      insertAudit({
        actorUserId: context.user.id,
        action: 'desktop_single_user_authorizations_disabled',
        after: {
          revokedAuthorizations: revoked.changes,
          revokedSessions,
          revokedGrants,
          rejectedRequests,
        },
        at: timestamp,
      });
      return {
        revokedAuthorizations: revoked.changes,
        revokedSessions,
        revokedGrants,
        rejectedRequests,
      };
    })();
    capabilityState = null;
    return Object.freeze(result);
  }

  return Object.freeze({
    bootstrapLocalHost,
    resetLocalHostCredential,
    issuePairingGrant,
    revokePairingGrant,
    currentPairingCapability,
    consumeEncryptedPairingRequest,
    disableSingleUserAuthorizations,
  });
}

function getSingleUserDesktopIdentityService(options = {}) {
  const { db } = options;
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) {
    throw identityError('DESKTOP_SINGLE_USER_DB_REQUIRED');
  }
  if (serviceByDatabase.has(db)) return serviceByDatabase.get(db);
  const service = createSingleUserDesktopIdentityService(options);
  serviceByDatabase.set(db, service);
  return service;
}

module.exports = {
  MAX_PAIRING_ATTEMPTS,
  PAIRING_TTL_MS,
  createSingleUserDesktopIdentityService,
  crockfordBase32,
  getSingleUserDesktopIdentityService,
};
