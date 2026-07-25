'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE } = require('./authorizationPolicy');
const {
  createSingleUserDesktopIdentityService,
  getSingleUserDesktopIdentityService,
} = require('./singleUserDesktopIdentityService');
const pairingProtocol = require('./singleUserPairingEnvelope');

async function main() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  const fixedNow = new Date('2026-07-23T04:00:00.000Z');
  let currentTime = new Date(fixedNow);
  let sequence = 0;
  let mode = 'single-user';
  let validationFailure = null;
  const hostKeys = crypto.generateKeyPairSync('ed25519');
  const hostPublicKey = hostKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const hostIdentity = {
    deviceId: 'host-device-1',
    deviceName: 'Authority Host',
    publicKey: hostPublicKey,
    deviceKind: 'primary-host',
  };
  const runtime = {
    deviceId: 'host-device-1',
    nodeRole: 'desktop-client',
    epochId: null,
    generation: null,
  };
  const evidence = {
    runtimeNodeRole: 'primary-host',
    dbInstanceDigest: 'a'.repeat(64),
    schemaVersion: 3120,
    storeId: 'question-store-1',
    dbAuthorityId: 'database-authority-1',
    quickCheck: 'ok',
  };
  const localValidationService = {
    async prepare(input) {
      if (validationFailure) {
        const error = new Error(validationFailure);
        error.code = validationFailure;
        throw error;
      }
      return {
        evidence: {
          ...evidence,
          runtimeNodeRole: input.bootstrapCandidateVerified === true
            ? 'primary-host'
            : evidence.runtimeNodeRole,
        },
        localValidation: {
          backup: {
            authoritative: true,
            sha256: 'b'.repeat(64),
            quickCheck: 'ok',
            schemaVersion: 3120,
            storeId: evidence.storeId,
            dbAuthorityId: evidence.dbAuthorityId,
          },
        },
      };
    },
  };

  db.prepare(`INSERT INTO users
    (id,phone,name,role,status,login_enabled,review_status,auth_version,
     is_super_admin_identity,deleted,created_at,updated_at)
    VALUES (?,?,'Canonical Owner','super_admin',1,1,'approved',1,1,0,?,?)`)
    .run(CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE, fixedNow.toISOString(), fixedNow.toISOString());
  db.prepare(`INSERT INTO user_role_grants
    (user_id,role,status,source,created_at,updated_at)
    VALUES (?,'super_admin','active','single-user-test',?,?)`)
    .run(CANONICAL_SUPER_ADMIN_ID, fixedNow.toISOString(), fixedNow.toISOString());
  db.prepare("INSERT INTO authority_metadata(key,value,updated_at) VALUES ('database_authority_id',?,?)")
    .run(evidence.dbAuthorityId, fixedNow.toISOString());
  db.prepare(`INSERT INTO question_bank_store_bindings
    (store_id,db_authority_id,root_path,bound_by,bound_at,status)
    VALUES (?,?,'question-bank',?,?, 'active')`)
    .run(evidence.storeId, evidence.dbAuthorityId, CANONICAL_SUPER_ADMIN_ID, fixedNow.toISOString());
  db.exec('CREATE TABLE single_user_business_probe(id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO single_user_business_probe(id,value) VALUES (?,?)').run('probe-1', 'preserve-me');

  const makeService = overrides => createSingleUserDesktopIdentityService({
    db,
    now: () => new Date(currentTime),
    uuid: () => `single-user-test-${++sequence}`,
    identityMode: () => mode,
    runtimeContext: () => ({ ...runtime }),
    localValidationService,
    ...overrides,
  });
  const service = makeService();
  const bootstrapInput = overrides => ({
    localBridgeVerified: true,
    bootstrapCandidateVerified: true,
    buildFlavor: 'primary-host',
    runtime: { ...runtime },
    publicIdentity: { ...hostIdentity },
    confirmation: 'SET_LOCAL_PASSWORD_CONFIRMED',
    ...overrides,
  });

  async function assertBootstrapRejected(overrides, code) {
    const before = db.prepare('SELECT COUNT(*) AS count FROM desktop_device_authorizations').get().count;
    await assert.rejects(service.bootstrapLocalHost(bootstrapInput(overrides)), error => error.code === code);
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) AS count FROM desktop_device_authorizations').get().count,
      before,
      `${code} must fail before authorization writes`
    );
  }

  mode = 'full';
  await assertBootstrapRejected({}, 'DESKTOP_SINGLE_USER_MODE_DISABLED');
  mode = 'single-user';
  await assertBootstrapRejected({ buildFlavor: 'desktop-client' }, 'DESKTOP_SINGLE_USER_HOST_BUILD_REQUIRED');
  await assertBootstrapRejected({ localBridgeVerified: false }, 'DESKTOP_SINGLE_USER_LOCAL_BRIDGE_REQUIRED');
  await assertBootstrapRejected({ bootstrapCandidateVerified: false }, 'DESKTOP_SINGLE_USER_BOOTSTRAP_CANDIDATE_REQUIRED');
  await assertBootstrapRejected({ runtime: { ...runtime, deviceId: 'wrong-device' } }, 'DESKTOP_SINGLE_USER_RUNTIME_MISMATCH');
  db.prepare("UPDATE user_role_grants SET status='revoked' WHERE user_id=? AND role='super_admin'")
    .run(CANONICAL_SUPER_ADMIN_ID);
  await assertBootstrapRejected({}, 'DESKTOP_SINGLE_USER_CANONICAL_OWNER_REQUIRED');
  db.prepare("UPDATE user_role_grants SET status='active' WHERE user_id=? AND role='super_admin'")
    .run(CANONICAL_SUPER_ADMIN_ID);
  evidence.quickCheck = 'corrupt';
  await assertBootstrapRejected({}, 'PRIMARY_HOST_SQLITE_QUICK_CHECK_FAILED');
  evidence.quickCheck = 'ok';
  const storeId = evidence.storeId;
  evidence.storeId = '';
  await assertBootstrapRejected({}, 'PRIMARY_HOST_QUESTION_BANK_BINDING_REQUIRED');
  evidence.storeId = storeId;
  validationFailure = 'PRIMARY_HOST_LOCAL_BACKUP_FAILED';
  await assertBootstrapRejected({}, 'PRIMARY_HOST_LOCAL_BACKUP_FAILED');
  validationFailure = null;

  const businessRowsBefore = db.prepare('SELECT COUNT(*) AS count FROM single_user_business_probe').get().count;
  const started = await service.bootstrapLocalHost(bootstrapInput());
  assert.strictEqual(started.authorization.authorizationSource, 'single_user_local_bootstrap');
  assert.strictEqual(started.authorization.deviceKind, 'primary-host');
  assert.strictEqual(started.epoch.generation, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM single_user_business_probe').get().count, businessRowsBefore);
  assert.strictEqual(db.prepare('SELECT value FROM single_user_business_probe WHERE id=?').get('probe-1').value, 'preserve-me');
  runtime.nodeRole = 'primary-host';
  runtime.epochId = started.epoch.id;
  runtime.generation = started.epoch.generation;

  const repeated = await service.bootstrapLocalHost(bootstrapInput({
    runtime: { ...runtime },
  }));
  assert.strictEqual(repeated.epoch.id, started.epoch.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM primary_host_epochs').get().count, 1);

  const replacementKeys = crypto.generateKeyPairSync('ed25519');
  const reset = service.resetLocalHostCredential({
    actor: started.actor,
    runtime: { ...runtime },
    publicIdentity: {
      ...hostIdentity,
      publicKey: replacementKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
    confirmation: 'RESET_LOCAL_PASSWORD_CONFIRMED',
  });
  assert.strictEqual(reset.authorization.credentialVersion, started.authorization.credentialVersion + 1);
  assert.notStrictEqual(reset.authorization.publicKey, started.authorization.publicKey);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM single_user_business_probe').get().count, businessRowsBefore);

  const grant = service.issuePairingGrant({ actor: reset.actor, runtime: { ...runtime } });
  assert.match(grant.code, /^[0-9A-HJKMNP-TV-Z]{16}$/);
  assert.strictEqual(Buffer.from(grant.code, 'utf8').length, 16);
  assert.ok(Date.parse(grant.expiresAt) - currentTime.getTime() <= 10 * 60 * 1000);
  const storedGrant = db.prepare('SELECT * FROM desktop_single_user_pairing_grants WHERE id=?').get(grant.id);
  assert.strictEqual(storedGrant.code_digest.includes(grant.code), false);
  assert.strictEqual(storedGrant.code_salt.includes(grant.code), false);
  assert.throws(
    () => service.issuePairingGrant({
      actor: reset.actor,
      runtime: { ...runtime, epochId: 'wrong-epoch' },
    }),
    error => error.code === 'DESKTOP_SINGLE_USER_RUNTIME_MISMATCH'
  );

  const ordinaryKeys = crypto.generateKeyPairSync('ed25519');
  const ordinaryDevice = {
    deviceId: 'ordinary-device-1',
    deviceName: 'Second PC',
    deviceKind: 'desktop-client',
    publicKey: ordinaryKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  const createEnvelope = (capability, code, device = ordinaryDevice, privateKey = ordinaryKeys.privateKey) => (
    pairingProtocol.encryptPairingRequest({
      capability,
      pairingCode: code,
      device,
      sign: payload => crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64'),
      now: () => new Date(currentTime),
    })
  );
  const envelope = createEnvelope(grant.capability, grant.code);
  const authorized = service.consumeEncryptedPairingRequest({ envelope, channel: 'direct' });
  assert.strictEqual(authorized.authorization.authorizationSource, 'single_user_pairing');
  assert.strictEqual(authorized.authorization.deviceKind, 'desktop-client');
  assert.strictEqual(db.prepare('SELECT status FROM desktop_single_user_pairing_grants WHERE id=?').get(grant.id).status, 'consumed');
  assert.throws(
    () => service.consumeEncryptedPairingRequest({ envelope, channel: 'direct' }),
    error => ['DESKTOP_PAIRING_REQUEST_REPLAYED', 'DESKTOP_PAIRING_GRANT_UNAVAILABLE'].includes(error.code)
  );
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM desktop_device_authorizations WHERE device_id=?').get(ordinaryDevice.deviceId).count,
    1
  );

  const lockedGrant = service.issuePairingGrant({ actor: reset.actor, runtime: { ...runtime } });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const wrongCode = `${String(attempt).padStart(16, '0')}`;
    const wrongEnvelope = createEnvelope(lockedGrant.capability, wrongCode);
    assert.throws(
      () => service.consumeEncryptedPairingRequest({ envelope: wrongEnvelope, channel: 'direct' }),
      error => error.code === (attempt === 5 ? 'DESKTOP_PAIRING_GRANT_LOCKED' : 'DESKTOP_PAIRING_CODE_INVALID')
    );
  }
  assert.strictEqual(db.prepare('SELECT status FROM desktop_single_user_pairing_grants WHERE id=?').get(lockedGrant.id).status, 'locked');

  const hostClaimKeys = crypto.generateKeyPairSync('ed25519');
  const hostClaimGrant = service.issuePairingGrant({ actor: reset.actor, runtime: { ...runtime } });
  assert.throws(() => createEnvelope(hostClaimGrant.capability, hostClaimGrant.code, {
    deviceId: 'fake-host',
    deviceName: 'Fake Host',
    deviceKind: 'primary-host',
    publicKey: hostClaimKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }, hostClaimKeys.privateKey), error => error.code === 'PAIRING_DEVICE_KIND_INVALID');

  const cachedA = getSingleUserDesktopIdentityService({
    db,
    now: () => new Date(currentTime),
    identityMode: () => mode,
    runtimeContext: () => ({ ...runtime }),
    localValidationService,
  });
  const cachedB = getSingleUserDesktopIdentityService({ db });
  assert.strictEqual(cachedA, cachedB);

  const disabled = service.disableSingleUserAuthorizations({ actor: reset.actor, runtime: { ...runtime } });
  assert.ok(disabled.revokedAuthorizations >= 1);
  assert.strictEqual(db.prepare('SELECT status FROM desktop_device_authorizations WHERE device_id=?').get(ordinaryDevice.deviceId).status, 'revoked');
  assert.strictEqual(db.prepare('SELECT status FROM desktop_device_authorizations WHERE device_id=?').get(hostIdentity.deviceId).status, 'active');
  mode = 'full';
  assert.throws(
    () => service.issuePairingGrant({ actor: reset.actor, runtime: { ...runtime } }),
    error => error.code === 'DESKTOP_SINGLE_USER_MODE_DISABLED'
  );

  db.close();
  console.log('single-user desktop identity service tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
