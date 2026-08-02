const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSignedAuthorityProjection,
} = require('../../../shared/authorityProjectionProtocol');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-cloud-control-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  jwtSecret: process.env.JWT_SECRET,
  nodeEnv: process.env.NODE_ENV,
};
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(workspace, 'cloud-control.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.JWT_SECRET = 'authority-cloud-control-http-test-secret';

const { DatabaseService } = require('../database');
const database = new DatabaseService();
const databaseModule = require('../database');
databaseModule.getInstance = () => database;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

const authorityId = 'authority-cloud-1';
const hostEpochId = 'epoch-cloud-1';
const hostDeviceId = 'host-cloud-1';
const hostCredential = 'host-cloud-control-test-credential';
const hostCredentialHash = crypto.createHash('sha256').update(hostCredential).digest('hex');
const hostKeyPair = crypto.generateKeyPairSync('ed25519');
const hostPublicKey = hostKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const hostPublicKeyFingerprint = crypto.createHash('sha256')
  .update(hostKeyPair.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');
const now = '2026-08-01T00:00:00.000Z';

function hostHeaders() {
  return {
    'content-type': 'application/json',
    'x-gewu-host-device-id': hostDeviceId,
    'x-gewu-host-generation': '1',
    'x-gewu-host-credential': hostCredential,
  };
}

async function requestJson(origin, requestPath, options = {}) {
  const response = await fetch(`${origin}${requestPath}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = text;
  }
  return { status: response.status, body };
}

database.db.pragma('foreign_keys = OFF');
for (const [userId, phone] of [
  ['cloud-admin-1', '19972110010'],
  ['cloud-visitor-1', '19972110011'],
]) {
  database.db.prepare(`INSERT INTO users
    (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,review_status,created_at,updated_at)
    VALUES(?,?,?,?,'visitor','visitor',1,1,'approved',?,?)`)
    .run(userId, phone, phone, userId, now, now);
  database.db.prepare(`INSERT INTO authority_accounts
    (user_id,authority_id,status,created_at,updated_at) VALUES(?,?,'active',?,?)`)
    .run(userId, authorityId, now, now);
}
database.db.prepare(`INSERT INTO primary_host_epochs
  (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
   challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
   host_public_key,credential_version,row_version,created_at,updated_at,activated_at,retired_at)
  VALUES(?,1,?,?,'authorization-cloud-1','active','bootstrap',NULL,
   'challenge-cloud-1','digest-cloud-1',1,'store-cloud-1',?,?,NULL,1,1,?,?,?,NULL)`)
  .run(hostEpochId, hostDeviceId, 'cloud-admin-1', authorityId, hostCredentialHash, now, now, now);
database.db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,status,grant_version,created_at,updated_at)
  VALUES('binding-cloud-admin-1',?,?,'super_admin','active',1,?,?)`)
  .run(authorityId, 'cloud-admin-1', now, now);
database.db.prepare(`INSERT INTO device_grants
  (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,created_at,updated_at)
  VALUES('grant-cloud-host-1',?,?,?,'host-device-public-key',1,'active',1,?,?)`)
  .run(authorityId, hostDeviceId, 'cloud-admin-1', now, now);
database.db.prepare(`INSERT INTO device_leases
  (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,issued_at,expires_at)
  VALUES('lease-cloud-host-1','grant-cloud-host-1',?,?,?,'super_admin',1,'active',?,'2026-08-15T00:00:00.000Z')`)
  .run(authorityId, hostDeviceId, 'cloud-admin-1', now);
database.db.pragma('foreign_keys = ON');

(async function main() {
  const server = createApp().listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const epochPublished = await requestJson(origin, '/api/authority/host/epoch', {
      method: 'POST',
      headers: hostHeaders(),
      body: JSON.stringify({
        epoch: {
          id: hostEpochId,
          authorityId,
          generation: 1,
          deviceId: hostDeviceId,
          hostSigningKey: {
            algorithm: 'Ed25519',
            publicKeyPem: hostPublicKey,
            publicKeyFingerprint: hostPublicKeyFingerprint,
          },
        },
      }),
    });
    assert.strictEqual(epochPublished.status, 200, JSON.stringify(epochPublished.body));

    const initialControls = await requestJson(origin, '/api/authority/host/control-records', {
      headers: hostHeaders(),
    });
    assert.strictEqual(initialControls.status, 200, JSON.stringify(initialControls.body));
    assert.deepStrictEqual(
      initialControls.body.snapshot.accounts.map(account => account.userId).sort(),
      ['cloud-admin-1', 'cloud-visitor-1'],
      'the host must receive cloud-owned accounts, including a newly registered miniapp visitor',
    );
    assert.deepStrictEqual(
      initialControls.body.snapshot.accounts.find(account => account.userId === 'cloud-visitor-1'),
      {
        userId: 'cloud-visitor-1',
        authorityId,
        status: 'active',
        phone: '19972110011',
        name: 'cloud-visitor-1',
        nickname: null,
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
      },
      'the cloud account snapshot must contain the minimal user subject needed by the host FK cache',
    );
    assert.deepStrictEqual(
      initialControls.body.snapshot.roleBindings.map(binding => binding.bindingId),
      [],
      'cloud control snapshots must not export role authorization without the original signed projection proof',
    );

    const hostSnapshot = {
      authorityId,
      hostEpochId,
      hostGeneration: 1,
      sourceVersion: 1,
      accounts: initialControls.body.snapshot.accounts.filter(account => account.userId !== 'cloud-visitor-1'),
      grants: initialControls.body.snapshot.grants,
      leases: initialControls.body.snapshot.leases,
      roleBindings: [{
        bindingId: 'binding-cloud-admin-1',
        authorityId,
        userId: 'cloud-admin-1',
        role: 'super_admin',
        subjectType: null,
        subjectId: null,
        status: 'active',
        grantVersion: 1,
        grantedBy: 'cloud-admin-1',
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
      }],
    };
    const controlsPublished = await requestJson(origin, '/api/authority/host/control-records', {
      method: 'POST',
      headers: hostHeaders(),
      body: JSON.stringify({ snapshot: hostSnapshot }),
    });
    assert.strictEqual(controlsPublished.status, 200, JSON.stringify(controlsPublished.body));
    assert.strictEqual(
      database.db.prepare("SELECT COUNT(*) AS count FROM authority_accounts WHERE user_id='cloud-visitor-1' AND status='active'").get().count,
      1,
      'a host mirror publish must never delete a cloud-owned miniapp account',
    );
    assert.strictEqual(
      database.db.prepare("SELECT role FROM authority_role_bindings WHERE binding_id='binding-cloud-admin-1'").get().role,
      'super_admin',
      'the unsigned compatibility controls POST must not mutate cloud role authorization',
    );

    const projection = createSignedAuthorityProjection({
      authorityId,
      hostEpochId,
      userId: 'cloud-visitor-1',
      role: 'visitor',
      sourceVersion: 1,
      generatedAt: now,
      payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
      privateKey: hostKeyPair.privateKey,
    });
    const projectionPublished = await requestJson(origin, '/api/authority/host/projections', {
      method: 'POST',
      headers: hostHeaders(),
      body: JSON.stringify({ projection }),
    });
    assert.strictEqual(projectionPublished.status, 200, JSON.stringify(projectionPublished.body));
    const storedProjection = database.db.prepare(`SELECT document_json FROM authority_scoped_projections
      WHERE authority_id=? AND user_id='cloud-visitor-1' AND role='visitor'`).get(authorityId);
    assert.ok(storedProjection?.document_json, 'the cloud backend must store the host-signed miniapp projection');

    const formalRoleProjection = createSignedAuthorityProjection({
      authorityId,
      hostEpochId,
      userId: 'cloud-admin-1',
      role: 'super_admin',
      sourceVersion: 2,
      generatedAt: '2026-08-01T00:00:01.000Z',
      payload: {
        schedules: [],
        courses: [],
        assets: [],
        questionPreviews: [],
        roleApplications: [],
        roleGrants: [{
          bindingId: 'binding-cloud-visitor-student-1',
          authorityId,
          userId: 'cloud-visitor-1',
          role: 'student',
          subjectType: 'student',
          subjectId: 'student-cloud-visitor-1',
          status: 'active',
          grantVersion: 1,
          grantedBy: 'cloud-admin-1',
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        }],
      },
      privateKey: hostKeyPair.privateKey,
    });
    const formalRolePublished = await requestJson(origin, '/api/authority/host/projections', {
      method: 'POST',
      headers: hostHeaders(),
      body: JSON.stringify({ projection: formalRoleProjection }),
    });
    assert.strictEqual(formalRolePublished.status, 200, JSON.stringify(formalRolePublished.body));
    assert.deepStrictEqual(
      database.db.prepare(`SELECT user_id AS userId,role,status FROM authority_role_bindings
        WHERE binding_id='binding-cloud-visitor-student-1'`).get(),
      { userId: 'cloud-visitor-1', role: 'student', status: 'active' },
      'only a verified super-admin projection may replace the cloud authorization mirror',
    );

    console.log('backend authority cloud-control HTTP checks passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    fs.rmSync(workspace, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === 'dbPath' ? 'DB_PATH'
        : key === 'readDbPath' ? 'READ_DB_PATH'
          : key === 'jwtSecret' ? 'JWT_SECRET' : 'NODE_ENV';
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
