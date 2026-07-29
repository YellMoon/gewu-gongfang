const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  authorityHttpSigningPayload,
} = require('../../../shared/authorityHttpAuth');
const { stableJson } = require('../../../shared/authorityProtocol');
const { createSignedAuthorityProjection } = require('../../../shared/authorityProjectionProtocol');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-gateway-authority-'));
const previous = {
  gatewayDbPath: process.env.GATEWAY_DB_PATH,
  hostToken: process.env.GEWU_CLOUD_RELAY_HOST_TOKEN,
};
process.env.GATEWAY_DB_PATH = path.join(workspace, 'gateway.db');
process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = 'gateway-authority-host-token';

const { closeDatabase, getDb, initDatabase } = require('../db/database');
const createApp = require('../app');
const keyPair = crypto.generateKeyPairSync('ed25519');
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const hostKeyPair = crypto.generateKeyPairSync('ed25519');
const hostPublicKey = hostKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const staleHostKeyPair = crypto.generateKeyPairSync('ed25519');
const staleHostPublicKey = staleHostKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const hostPublicKeyFingerprint = crypto.createHash('sha256')
  .update(hostKeyPair.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');
const hostCredential = 'managed-host-credential-test-only';
const hostCredentialHash = crypto.createHash('sha256').update(hostCredential).digest('hex');
const actor = Object.freeze({ userId: 'user-1', deviceId: 'device-1', role: 'teacher' });
const envelope = Object.freeze({
  protocol: 'gewu.authority-command.v1',
  commandId: 'command-1',
  idempotencyKey: 'key-1',
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  actor,
  lease: Object.freeze({ id: 'lease-1', grantVersion: 1 }),
  type: 'schedule.update.v1',
  payload: Object.freeze({ id: 'schedule-1', changes: Object.freeze({ notes: 'safe' }) }),
  payloadHash: crypto.createHash('sha256').update(stableJson({
    id: 'schedule-1',
    changes: { notes: 'safe' },
  })).digest('hex'),
  createdAt: '2026-07-28T00:00:00.000Z',
});

function deviceHeaders(method, requestPath, body) {
  const signature = crypto.sign(
    null,
    Buffer.from(authorityHttpSigningPayload({
      method,
      path: requestPath,
      actor,
      body,
    }), 'utf8'),
    keyPair.privateKey
  ).toString('base64');
  return {
    'content-type': 'application/json',
    'x-gewu-authority-user-id': actor.userId,
    'x-gewu-authority-device-id': actor.deviceId,
    'x-gewu-authority-role': actor.role,
    'x-gewu-device-signature': signature,
  };
}

async function requestJson(origin, requestPath, options = {}) {
  const response = await fetch(`${origin}${requestPath}`, options);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

(async function main() {
  let server;
  try {
    const db = initDatabase();
    const now = '2026-07-28T00:00:00.000Z';
    db.prepare(`INSERT INTO users
      (id, phone, name, user_type, status, login_enabled, review_status, created_at, updated_at)
      VALUES ('user-1', '13000000001', 'Authority User', 'teacher', 1, 1, 'approved', ?, ?)`)
      .run(now, now);
    db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
      VALUES('user-1','authority-1','active',?,?)`).run(now, now);
    db.prepare(`INSERT INTO authority_role_bindings
      (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
      VALUES('binding-1','authority-1','user-1','teacher','teacher','teacher-1','active',1,?,?)`)
      .run(now, now);
    db.prepare(`INSERT INTO device_grants
      (grant_id,authority_id,device_id,user_id,public_key,host_generation,status,grant_version,created_at,updated_at)
      VALUES('grant-1','authority-1','device-1','user-1',?,1,'active',1,?,?)`)
      .run(publicKey, now, now);
    db.prepare(`INSERT INTO device_leases
      (lease_id,grant_id,authority_id,device_id,user_id,active_role,grant_version,status,issued_at,expires_at)
      VALUES('lease-1','grant-1','authority-1','device-1','user-1','teacher',1,'active',?,'2026-08-11T00:00:00.000Z')`)
      .run(now);
    db.prepare(`INSERT INTO primary_host_epochs
      (id,db_authority_id,generation,device_id,status,host_credential_hash,host_public_key,credential_version,created_at,updated_at,activated_at)
      VALUES('epoch-1','authority-1',1,'host-1','active',?,?,1,?,?,?)`)
      .run(hostCredentialHash, staleHostPublicKey, now, now, now);

    server = createApp().listen(0);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const submitPath = '/api/authority/commands';
    const accepted = await requestJson(origin, submitPath, {
      method: 'POST',
      headers: deviceHeaders('POST', submitPath, envelope),
      body: JSON.stringify(envelope),
    });
    assert.strictEqual(accepted.status, 202, JSON.stringify(accepted.body));
    assert.strictEqual(accepted.body.command.id, envelope.commandId);
    assert.strictEqual(getDb().prepare('SELECT COUNT(*) AS count FROM host_commands').get().count, 1);

    const rejected = await requestJson(origin, submitPath, {
      method: 'POST',
      headers: {
        ...deviceHeaders('POST', submitPath, envelope),
        'x-gewu-device-signature': Buffer.alloc(64).toString('base64'),
      },
      body: JSON.stringify({ ...envelope, commandId: 'command-2', idempotencyKey: 'key-2' }),
    });
    assert.strictEqual(rejected.status, 401);
    assert.strictEqual(rejected.body.error.code, 'AUTHORITY_DEVICE_SIGNATURE_INVALID');
    assert.strictEqual(getDb().prepare('SELECT COUNT(*) AS count FROM host_commands').get().count, 1);

    const hostHeaders = {
      'content-type': 'application/json',
      'x-gewu-host-device-id': 'host-1',
      'x-gewu-host-generation': '1',
      'x-gewu-host-credential': hostCredential,
    };
    const legacyHost = await requestJson(origin, '/api/authority/host/commands/claim', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gewu-host-token': process.env.GEWU_CLOUD_RELAY_HOST_TOKEN,
        'x-gewu-host-device-id': 'host-1',
      },
      body: JSON.stringify({ claimToken: 'legacy-claim', leaseMs: 30000, limit: 10 }),
    });
    assert.strictEqual(legacyHost.status, 403);
    const claimed = await requestJson(origin, '/api/authority/host/commands/claim', {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ claimToken: 'claim-1', leaseMs: 30000, limit: 10 }),
    });
    assert.strictEqual(claimed.status, 200, JSON.stringify(claimed.body));
    assert.strictEqual(claimed.body.commands[0].envelope.commandId, envelope.commandId);

    const receipt = Object.freeze({
      protocol: 'gewu.authority-receipt.v1',
      commandId: envelope.commandId,
      payloadHash: envelope.payloadHash,
      status: 'committed',
      resultHash: 'result-hash-1',
      authorityId: envelope.authorityId,
      hostEpochId: envelope.hostEpochId,
      projectionVersion: 1,
      completedAt: '2026-07-28T00:00:01.000Z',
      result: Object.freeze({ ok: true }),
    });
    const published = await requestJson(origin, `/api/authority/host/commands/${envelope.commandId}/receipt`, {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ claimToken: 'claim-1', receipt }),
    });
    assert.strictEqual(published.status, 200, JSON.stringify(published.body));

    const receiptPath = `/api/authority/commands/${envelope.commandId}/receipt`;
    const read = await requestJson(origin, receiptPath, {
      headers: deviceHeaders('GET', receiptPath, null),
    });
    assert.strictEqual(read.status, 200, JSON.stringify(read.body));
    assert.deepStrictEqual(read.body.receipt, receipt);

    const epochPublished = await requestJson(origin, '/api/authority/host/epoch', {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({
        epoch: {
          id: 'epoch-1',
          authorityId: 'authority-1',
          generation: 1,
          deviceId: 'host-1',
          hostSigningKey: {
            algorithm: 'Ed25519',
            publicKeyPem: hostPublicKey,
            publicKeyFingerprint: hostPublicKeyFingerprint,
          },
        },
      }),
    });
    assert.strictEqual(epochPublished.status, 200, JSON.stringify(epochPublished.body));
    assert.strictEqual(
      getDb().prepare("SELECT host_public_key FROM primary_host_epochs WHERE id='epoch-1'").get()
        .host_public_key,
      hostPublicKey
    );

    const controlSnapshot = {
      authorityId: 'authority-1',
      hostEpochId: 'epoch-1',
      hostGeneration: 1,
      sourceVersion: 1,
      accounts: [{
        userId: 'user-1', authorityId: 'authority-1', status: 'active',
        createdAt: now, updatedAt: now,
      }],
      grants: [{
        grantId: 'grant-1', authorityId: 'authority-1', deviceId: 'device-1',
        userId: 'user-1', publicKey, hostGeneration: 1, status: 'active',
        grantVersion: 1, createdAt: now, updatedAt: now,
      }],
      leases: [{
        leaseId: 'lease-1', grantId: 'grant-1', authorityId: 'authority-1',
        deviceId: 'device-1', userId: 'user-1', activeRole: 'teacher',
        grantVersion: 1, status: 'active', issuedAt: now,
        expiresAt: '2026-08-11T00:00:00.000Z',
      }],
      roleBindings: [{ bindingId: 'binding-1', authorityId: 'authority-1', userId: 'user-1', role: 'teacher', subjectType: 'teacher', subjectId: 'teacher-1', status: 'active', grantVersion: 1, createdAt: now, updatedAt: now }],
    };
    const controlsPublished = await requestJson(origin, '/api/authority/host/control-records', {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ snapshot: controlSnapshot }),
    });
    assert.strictEqual(controlsPublished.status, 200, JSON.stringify(controlsPublished.body));
    assert.strictEqual(controlsPublished.body.result.grants, 1);
    assert.strictEqual(
      getDb().prepare("SELECT status FROM device_leases WHERE lease_id='lease-1'").get().status,
      'active',
    );
    const controlsRead = await requestJson(origin, '/api/authority/host/control-records', {
      headers: hostHeaders,
    });
    assert.strictEqual(controlsRead.status, 200, JSON.stringify(controlsRead.body));
    assert.strictEqual(controlsRead.body.snapshot.authorityId, controlSnapshot.authorityId);
    assert.strictEqual(controlsRead.body.snapshot.grants[0].grantId, 'grant-1');
    const epochRead = await requestJson(origin, '/api/authority/host/epoch', { headers: hostHeaders });
    assert.strictEqual(epochRead.status, 200, JSON.stringify(epochRead.body));
    assert.strictEqual(epochRead.body.epoch.id, 'epoch-1');
    const wrongControlScope = await requestJson(origin, '/api/authority/host/control-records', {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({
        snapshot: { ...controlSnapshot, authorityId: 'authority-other', sourceVersion: 2 },
      }),
    });
    assert.strictEqual(wrongControlScope.status, 403);
    assert.strictEqual(
      wrongControlScope.body.error.code,
      'AUTHORITY_DEVICE_CONTROL_MIRROR_HOST_MISMATCH',
    );

    const projection = createSignedAuthorityProjection({
      authorityId: 'authority-1',
      hostEpochId: 'epoch-1',
      userId: actor.userId,
      role: actor.role,
      sourceVersion: 1,
      generatedAt: '2026-07-28T00:00:02.000Z',
      payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
      privateKey: hostKeyPair.privateKey,
    });
    const projectionPublished = await requestJson(origin, '/api/authority/host/projections', {
      method: 'POST',
      headers: hostHeaders,
      body: JSON.stringify({ projection }),
    });
    assert.strictEqual(projectionPublished.status, 200, JSON.stringify(projectionPublished.body));
    const projectionPath = '/api/authority/projections/current';
    const projectionRead = await requestJson(origin, projectionPath, {
      headers: {
        ...deviceHeaders('GET', projectionPath, null),
        'x-gewu-authority-id': envelope.authorityId,
        'x-gewu-authority-lease-id': envelope.lease.id,
        'x-gewu-authority-grant-version': String(envelope.lease.grantVersion),
      },
    });
    assert.strictEqual(projectionRead.status, 200, JSON.stringify(projectionRead.body));
    assert.deepStrictEqual(projectionRead.body.projection, projection);

    console.log('gateway authority protocol HTTP tests passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    closeDatabase();
    if (previous.gatewayDbPath === undefined) delete process.env.GATEWAY_DB_PATH;
    else process.env.GATEWAY_DB_PATH = previous.gatewayDbPath;
    if (previous.hostToken === undefined) delete process.env.GEWU_CLOUD_RELAY_HOST_TOKEN;
    else process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = previous.hostToken;
    assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
