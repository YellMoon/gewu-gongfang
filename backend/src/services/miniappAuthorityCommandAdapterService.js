const crypto = require('crypto');
const { PROTOCOL, stableJson, validateEnvelope } = require('../../../shared/authorityProtocol');

const REQUESTABLE_ROLES = new Set(['student', 'teacher']);
const LEASE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

function adapterError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function requiredText(value, code, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw adapterError(code);
  return normalized;
}

function optionalText(value, code, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw adapterError(code);
  return normalized;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createMiniappAuthorityCommandAdapterService({
  db,
  now = () => new Date().toISOString(),
  createId = prefix => `${prefix}-${crypto.randomUUID()}`,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw adapterError('MINIAPP_AUTHORITY_ADAPTER_DATABASE_REQUIRED', 500);
  }

  function currentTime() {
    const value = new Date(now());
    if (!Number.isFinite(value.getTime())) throw adapterError('MINIAPP_AUTHORITY_CLOCK_INVALID', 500);
    return value;
  }

  function ensureSession({ userId, sessionId, authorityId }) {
    const user = requiredText(userId, 'MINIAPP_AUTHORITY_USER_REQUIRED');
    const session = requiredText(sessionId, 'MINIAPP_AUTHORITY_SESSION_REQUIRED');
    const authority = requiredText(authorityId, 'MINIAPP_AUTHORITY_ID_REQUIRED');
    const account = db.prepare(`SELECT user_id,authority_id,status FROM authority_accounts
      WHERE authority_id=? AND user_id=?`).get(authority, user);
    if (!account || account.status !== 'active') {
      throw adapterError('MINIAPP_AUTHORITY_ACCOUNT_INACTIVE', 403);
    }
    const epoch = db.prepare(`SELECT id,device_id,generation FROM primary_host_epochs
      WHERE db_authority_id=? AND status='active'`).get(authority);
    if (!epoch) throw adapterError('MINIAPP_AUTHORITY_HOST_EPOCH_INACTIVE', 503);

    const deviceId = `miniapp-${digest(`${authority}\n${user}`).slice(0, 32)}`;
    const grantId = `miniapp-grant-${digest(`${authority}\n${deviceId}`).slice(0, 32)}`;
    const leaseId = `miniapp-lease-${digest(`${authority}\n${user}\n${session}`).slice(0, 32)}`;
    const timestamp = currentTime();
    const timestampIso = timestamp.toISOString();
    const expiresAt = new Date(timestamp.getTime() + LEASE_DURATION_MS).toISOString();

    const transaction = db.transaction(() => {
      const existingGrant = db.prepare(`SELECT * FROM device_grants
        WHERE authority_id=? AND device_id=?`).get(authority, deviceId);
      if (existingGrant && (existingGrant.user_id !== user || existingGrant.status !== 'active')) {
        throw adapterError('MINIAPP_AUTHORITY_DEVICE_GRANT_INACTIVE', 403);
      }
      if (!existingGrant) {
        db.prepare(`INSERT INTO device_grants
          (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,
           grant_version,approved_by,created_at,updated_at,revoked_at)
          VALUES(?,?,?,?,?,?,'active',1,'miniapp-jwt-adapter',?,?,NULL)`)
          .run(
            grantId,
            authority,
            deviceId,
            user,
            'miniapp-jwt-adapter:v1',
            Number(epoch.generation),
            timestampIso,
            timestampIso,
          );
      } else if (Number(existingGrant.host_generation) !== Number(epoch.generation)) {
        db.prepare(`UPDATE device_grants SET host_generation=?,grant_version=grant_version+1,
          updated_at=? WHERE grant_id=? AND status='active'`)
          .run(Number(epoch.generation), timestampIso, existingGrant.grant_id);
      }
      const grant = db.prepare('SELECT * FROM device_grants WHERE authority_id=? AND device_id=?')
        .get(authority, deviceId);
      db.prepare(`INSERT INTO device_leases
        (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,
         issued_at,expires_at,revoked_at)
        VALUES(?,?,?,?,?,'visitor',?,'active',?,?,NULL)
        ON CONFLICT(lease_id) DO UPDATE SET
          grant_id=excluded.grant_id,
          authority_id=excluded.authority_id,
          device_id=excluded.device_id,
          user_id=excluded.user_id,
          active_role='visitor',
          grant_version=excluded.grant_version,
          status='active',
          issued_at=excluded.issued_at,
          expires_at=excluded.expires_at,
          revoked_at=NULL`)
        .run(
          leaseId,
          grant.grant_id,
          authority,
          deviceId,
          user,
          Number(grant.grant_version),
          timestampIso,
          expiresAt,
        );
      return Object.freeze({
        authorityId: authority,
        hostEpochId: epoch.id,
        hostDeviceId: epoch.device_id,
        deviceId,
        grantId: grant.grant_id,
        grantVersion: Number(grant.grant_version),
        leaseId,
        expiresAt,
      });
    });
    return typeof transaction.immediate === 'function' ? transaction.immediate() : transaction();
  }

  function createRoleApplicationEnvelope(input = {}) {
    const requestedRole = String(input.requestedRole || '').trim();
    if (!REQUESTABLE_ROLES.has(requestedRole)) {
      throw adapterError('MINIAPP_ROLE_APPLICATION_FORBIDDEN', 403);
    }
    const idempotencyKey = requiredText(
      input.idempotencyKey,
      'MINIAPP_ROLE_APPLICATION_IDEMPOTENCY_REQUIRED',
      160,
    );
    const bindingHint = optionalText(
      input.bindingHint,
      'MINIAPP_ROLE_APPLICATION_BINDING_HINT_INVALID',
    );
    const session = ensureSession(input);
    const payload = Object.freeze({
      requestedRole,
      ...(bindingHint ? { bindingHint } : {}),
    });
    const createdAt = currentTime().toISOString();
    const envelope = validateEnvelope({
      protocol: PROTOCOL,
      commandId: requiredText(createId('miniapp-command'), 'MINIAPP_AUTHORITY_COMMAND_ID_INVALID'),
      idempotencyKey,
      authorityId: session.authorityId,
      hostEpochId: session.hostEpochId,
      actor: {
        userId: requiredText(input.userId, 'MINIAPP_AUTHORITY_USER_REQUIRED'),
        deviceId: session.deviceId,
        role: 'visitor',
      },
      lease: {
        id: session.leaseId,
        grantVersion: session.grantVersion,
      },
      type: 'role-application.submit.v1',
      payload,
      payloadHash: digest(stableJson(payload)),
      createdAt,
    });
    return Object.freeze({ envelope, session });
  }

  function sessionFor(input = {}) {
    return ensureSession(input);
  }

  return Object.freeze({ createRoleApplicationEnvelope, sessionFor });
}

module.exports = {
  LEASE_DURATION_MS,
  createMiniappAuthorityCommandAdapterService,
  adapterError,
};
