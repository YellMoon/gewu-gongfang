const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { authorityHttpSigningPayload } = require('../../../shared/authorityHttpAuth');
const { stableJson } = require('../../../shared/authorityProtocol');
const { createSignedAuthorityProjection } = require('../../../shared/authorityProjectionProtocol');
const { createAuthorityProjectionStoreService } = require('../services/authorityProjectionStoreService');
const { createAuthorityCloudEpochService } = require('../services/authorityCloudEpochService');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-app-http-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tempRoot, 'authority-app.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.JWT_SECRET = 'authority-app-http-test-secret';

const { DatabaseService } = require('../database');
const database = new DatabaseService();
const testUser = database.db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
const token = jwt.sign({ id: testUser.id }, process.env.JWT_SECRET, { algorithm: 'HS256' });
const keyPair = crypto.generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const actor = Object.freeze({ userId: testUser.id, deviceId: 'device-app-1', role: 'teacher' });
const activeLeaseExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const payload = Object.freeze({ id: 'schedule-1', changes: Object.freeze({ notes: 'signed LAN command' }) });
let envelope = Object.freeze({
  protocol: 'gewu.authority-command.v1',
  commandId: 'app-command-1',
  idempotencyKey: 'app-key-1',
  authorityId: 'authority-app-1',
  hostEpochId: 'epoch-app-1',
  actor,
  lease: Object.freeze({ id: 'lease-app-1', grantVersion: 1 }),
  type: 'schedule.update.v1',
  payload,
  payloadHash: crypto.createHash('sha256').update(stableJson(payload)).digest('hex'),
  createdAt: '2026-07-28T00:00:00.000Z',
});
database.db.pragma('foreign_keys = OFF');
database.db.prepare(`INSERT INTO primary_host_epochs
  (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
   challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
   credential_version,row_version,created_at,updated_at,activated_at,retired_at)
  VALUES(?,1,'host-app-1',?,'authorization-app-1','active','bootstrap',NULL,
   'challenge-app-1','digest-app-1',1,'store-app-1',?,'credential-hash-app-1',
   1,1,?,?,?,NULL)`)
  .run(envelope.hostEpochId, actor.userId, envelope.authorityId,
    envelope.createdAt, envelope.createdAt, envelope.createdAt);
database.db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
  VALUES('binding-app-1',?,?,'teacher','teacher','teacher-app-1','active',1,?,?)`)
  .run(envelope.authorityId, actor.userId, envelope.createdAt, envelope.createdAt);
database.db.prepare(`INSERT INTO authority_accounts
  (user_id,authority_id,status,created_at,updated_at)
  VALUES(?,?,'active',?,?)`)
  .run(actor.userId, envelope.authorityId, envelope.createdAt, envelope.createdAt);
database.db.prepare(`INSERT INTO device_grants
  (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,created_at,updated_at)
  VALUES('grant-app-1',?,?,?,?,1,'active',1,?,?)`)
  .run(envelope.authorityId, actor.deviceId, actor.userId, publicKey,
    envelope.createdAt, envelope.createdAt);
database.db.prepare(`INSERT INTO device_leases
  (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,issued_at,expires_at)
  VALUES(?,'grant-app-1',?,?,?,'teacher',1,'active',?,?)`)
  .run(envelope.lease.id, envelope.authorityId, actor.deviceId, actor.userId, envelope.createdAt, activeLeaseExpiresAt);
database.db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
  VALUES('binding-super-app-1',?,?,'super_admin',NULL,NULL,'active',1,?,?)`)
  .run(envelope.authorityId, actor.userId, envelope.createdAt, envelope.createdAt);
database.db.prepare(`INSERT INTO device_leases
  (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,issued_at,expires_at)
  VALUES('lease-super-app-1','grant-app-1',?,?,?,'super_admin',1,'active',?,?)`)
  .run(envelope.authorityId, actor.deviceId, actor.userId, envelope.createdAt, activeLeaseExpiresAt);
database.db.prepare(`INSERT INTO users
  (id,name,role,status,login_enabled,review_status,created_at,updated_at)
  VALUES('admin-target-app-1','Admin target','visitor',1,1,'approved',?,?)`)
  .run(envelope.createdAt, envelope.createdAt);
database.db.prepare(`INSERT INTO authority_accounts
  (user_id,authority_id,status,created_at,updated_at)
  VALUES('admin-target-app-1',?,'active',?,?)`)
  .run(envelope.authorityId, envelope.createdAt, envelope.createdAt);
database.db.pragma('foreign_keys = ON');
const cloudEpoch = createAuthorityCloudEpochService({ db: database.db }).ensure(envelope.authorityId);
envelope = Object.freeze({ ...envelope, hostEpochId: cloudEpoch.id });
const databaseModule = require('../database');
databaseModule.getInstance = () => database;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

(async function main() {
  const server = createApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/api/authority/commands`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope),
    });
    const responseText = await response.text();
    let body = null;
    try {
      body = responseText ? JSON.parse(responseText) : null;
    } catch (_error) {
      body = null;
    }
    assert.strictEqual(response.status, 401, 'the formal app route must exist and reject an unauthenticated actor');
    assert.strictEqual(body.error.code, 'AUTHORITY_ACTOR_REQUIRED');
    assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS count FROM authority_command_ledger').get().count, 0);

    const requestPath = '/api/authority/commands';
    const signature = crypto.sign(null, Buffer.from(authorityHttpSigningPayload({
      method: 'POST',
      path: requestPath,
      actor,
      body: envelope,
    }), 'utf8'), keyPair.privateKey).toString('base64');
    const signedResponse = await fetch(`${baseUrl}${requestPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gewu-authority-user-id': actor.userId,
        'x-gewu-authority-device-id': actor.deviceId,
        'x-gewu-authority-role': actor.role,
        'x-gewu-device-signature': signature,
      },
      body: JSON.stringify(envelope),
    });
    const signedBody = await signedResponse.json();
    assert.strictEqual(signedResponse.status, 200, JSON.stringify(signedBody));
    assert.strictEqual(signedBody.command.id, envelope.commandId);
    assert.strictEqual(signedBody.receipt.commandId, envelope.commandId);
    assert.strictEqual(database.db.prepare('SELECT COUNT(*) AS count FROM authority_command_ledger').get().count, 1);

    const retiredHostRoute = await fetch(`${baseUrl}/api/authority/host/commands/claim`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit: 1 }),
    });
    assert.strictEqual(retiredHostRoute.status, 404,
      'the cloud app must not retain a host command-claim compatibility route');

    const directGrantPayload = Object.freeze({ userId: 'admin-target-app-1' });
    const directGrant = Object.freeze({
      ...envelope,
      commandId: 'app-command-direct-admin-1',
      idempotencyKey: 'app-key-direct-admin-1',
      type: 'role-admin.grant.v1',
      payload: directGrantPayload,
      payloadHash: crypto.createHash('sha256').update(stableJson(directGrantPayload)).digest('hex'),
    });
    const forbiddenGrantSignature = crypto.sign(null, Buffer.from(authorityHttpSigningPayload({
      method: 'POST', path: requestPath, actor, body: directGrant,
    }), 'utf8'), keyPair.privateKey).toString('base64');
    const forbiddenGrant = await fetch(`${baseUrl}${requestPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gewu-authority-user-id': actor.userId,
        'x-gewu-authority-device-id': actor.deviceId,
        'x-gewu-authority-role': actor.role,
        'x-gewu-device-signature': forbiddenGrantSignature,
      },
      body: JSON.stringify(directGrant),
    });
    const forbiddenGrantBody = await forbiddenGrant.json();
    assert.strictEqual(forbiddenGrant.status, 200);
    assert.strictEqual(forbiddenGrantBody.receipt.status, 'rejected');
    assert.strictEqual(forbiddenGrantBody.receipt.result.error.code, 'COMMAND_TYPE_UNSUPPORTED');
    const projection = createSignedAuthorityProjection({
      authorityId: envelope.authorityId,
      hostEpochId: envelope.hostEpochId,
      userId: actor.userId,
      role: actor.role,
      sourceVersion: 1,
      generatedAt: '2026-07-28T00:00:01.000Z',
      payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
      privateKey: keyPair.privateKey,
    });
    createAuthorityProjectionStoreService({ db: database.db }).publish(projection);
    const projectionPath = '/api/authority/projections/current';
    const projectionSignature = crypto.sign(null, Buffer.from(authorityHttpSigningPayload({
      method: 'GET',
      path: projectionPath,
      actor,
      body: null,
    }), 'utf8'), keyPair.privateKey).toString('base64');
    const projectionResponse = await fetch(`${baseUrl}${projectionPath}`, {
      headers: {
        'x-gewu-authority-user-id': actor.userId,
        'x-gewu-authority-device-id': actor.deviceId,
        'x-gewu-authority-role': actor.role,
        'x-gewu-device-signature': projectionSignature,
        'x-gewu-authority-id': envelope.authorityId,
        'x-gewu-authority-lease-id': envelope.lease.id,
        'x-gewu-authority-grant-version': String(envelope.lease.grantVersion),
      },
    });
    const projectionBody = await projectionResponse.json();
    assert.strictEqual(projectionResponse.status, 200, JSON.stringify(projectionBody));
    assert.deepStrictEqual(projectionBody.projection, projection);
    console.log('authorityProtocol formal app HTTP tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    assert.ok(path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
