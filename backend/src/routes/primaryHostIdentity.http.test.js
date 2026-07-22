const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE } = require('../services/authorizationPolicy');
const {
  PHYSICAL_CONFIRMATION,
  createPrimaryHostLocalReceipt,
  primaryHostReceiptSigningPayload,
} = require('../services/primaryHostReceiptProtocol');
const {
  DELIVERY_PROTOCOL_VERSION,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  generateRecoveryDeliveryKeyPair,
  openRecoveryPackage,
  signRecoveryDeliveryAcknowledgement,
} = require('../services/primaryHostRecoveryDeliveryProtocol');
const { buildPrimaryHostOperationManifest } = require('../../../public/primaryHostOperationValidation');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-primary-host-http-'));
const previous = {
  DB_PATH: process.env.DB_PATH,
  READ_DB_PATH: process.env.READ_DB_PATH,
  GEWU_CLOUD_RELAY_HOST_TOKEN: process.env.GEWU_CLOUD_RELAY_HOST_TOKEN,
  GEWU_LOCAL_CACHE_PATH: process.env.GEWU_LOCAL_CACHE_PATH,
};
process.env.DB_PATH = path.join(root, 'host-control.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = 'primary-host-root-secret-for-http-tests';
process.env.GEWU_LOCAL_CACHE_PATH = path.join(root, 'local-cache');

const { DatabaseService } = require('../database');
const databaseService = new DatabaseService();
const db = databaseService.db;
const currentTime = '2026-07-18T01:00:00.000Z';
const stagedHostCredentials = Object.freeze({
  bootstrap: 'locally-staged-bootstrap-host-credential-for-http-tests',
  transfer: 'locally-staged-transfer-host-credential-for-http-tests',
});
const recoveryDeliveryKeyPairs = Object.freeze({
  bootstrap: generateRecoveryDeliveryKeyPair(),
  transfer: generateRecoveryDeliveryKeyPair(),
});
function recoveryDeliveryPublicKey(operation) {
  const key = recoveryDeliveryKeyPairs[operation];
  return {
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    algorithm: RECOVERY_DELIVERY_KEY_ALGORITHM,
    publicKeyPem: key.publicKeyPem,
    publicKeyFingerprint: key.publicKeyFingerprint,
  };
}
function decryptRecoveryDelivery(result, operation, deviceId) {
  const delivery = result.recoveryDelivery;
  return openRecoveryPackage({
    envelope: delivery.envelope,
    privateKeyPem: recoveryDeliveryKeyPairs[operation].privateKeyPem,
    expected: {
      epochId: delivery.epochId,
      factorId: delivery.factorId,
      deviceId,
      generation: delivery.generation,
      recipientPublicKeyFingerprint: delivery.recipientKeyFingerprint,
    },
  });
}
function credentialStage(operation, challengeId, deviceId, targetGeneration) {
  const credential = stagedHostCredentials[operation];
  return {
    id: `${operation}:${challengeId}`,
    deviceId,
    targetGeneration,
    commitment: crypto.createHash('sha256').update(credential).digest('hex'),
  };
}
const questionBankRoot = path.join(root, 'question-bank');
fs.mkdirSync(questionBankRoot, { recursive: true });
db.prepare(`INSERT INTO authority_metadata (key,value,updated_at)
  VALUES ('database_authority_id','http-db-authority-1',?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
  .run(currentTime);
db.prepare(`INSERT INTO question_bank_store_bindings
  (store_id,db_authority_id,root_path,bound_by,bound_at,status)
  VALUES ('http-store-1','http-db-authority-1',?,'http-test',?,'active')
  ON CONFLICT(store_id) DO UPDATE SET db_authority_id=excluded.db_authority_id,
    root_path=excluded.root_path,bound_by=excluded.bound_by,bound_at=excluded.bound_at,status='active'`)
  .run(questionBankRoot, currentTime);
const seededOwner = db.prepare('SELECT id FROM users WHERE id=?').get(CANONICAL_SUPER_ADMIN_ID);
if (seededOwner) {
  db.prepare(`UPDATE users SET phone=?, name='Host Owner', role='super_admin', status=1,
    login_enabled=1, review_status='approved', auth_version=1,
    is_super_admin_identity=1, deleted=0, updated_at=? WHERE id=?`)
    .run(SUPER_ADMIN_PHONE, currentTime, CANONICAL_SUPER_ADMIN_ID);
} else {
  db.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, review_status, auth_version,
     is_super_admin_identity, deleted, created_at, updated_at)
    VALUES (?, ?, 'Host Owner', 'super_admin', 1, 1, 'approved', 1, 1, 0, ?, ?)`)
    .run(CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE, currentTime, currentTime);
}
db.prepare(`INSERT OR IGNORE INTO user_role_grants
  (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
  VALUES (?, 'super_admin', NULL, NULL, 'active', 'http-test', ?, ?)`)
  .run(CANONICAL_SUPER_ADMIN_ID, currentTime, currentTime);
const deviceKeyPair = crypto.generateKeyPairSync('ed25519');
const devicePublicKey = deviceKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const deviceKeyFingerprint = crypto.createHash('sha256')
  .update(deviceKeyPair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
   credential_version, row_version, created_at, updated_at)
  VALUES ('authorization-http-host', 'http-host-device', 'Current host', 'primary-host', ?,
    ?, ?, 'active', 'source-http-host', ?, '2026-08-18T01:00:00.000Z', 1, 1, ?, ?)`)
  .run(CANONICAL_SUPER_ADMIN_ID, devicePublicKey, deviceKeyFingerprint, currentTime, currentTime, currentTime);
const targetDeviceKeyPair = crypto.generateKeyPairSync('ed25519');
const targetDevicePublicKey = targetDeviceKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const targetDeviceKeyFingerprint = crypto.createHash('sha256')
  .update(targetDeviceKeyPair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
   credential_version, row_version, created_at, updated_at)
  VALUES ('authorization-http-target', 'http-target-device', 'Target host', 'desktop-client', ?,
    ?, ?, 'active', 'source-http-target', ?, '2026-08-18T01:00:00.000Z', 1, 1, ?, ?)`)
  .run(CANONICAL_SUPER_ADMIN_ID, targetDevicePublicKey, targetDeviceKeyFingerprint,
    currentTime, currentTime, currentTime);
db.prepare(`INSERT INTO miniapp_login_events
  (id, user_id, phone_normalized, identity_kind, result_code, session_id,
   miniapp_version, platform, created_at)
  VALUES ('host-http-phone-event', ?, ?, 'admin', 'FORMAL_LOGIN_SUCCESS',
    'host-http-phone-session', 'http-test', 'weapp', ?)`)
  .run(CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE, currentTime);
db.prepare(`INSERT INTO miniapp_login_events
  (id, user_id, phone_normalized, identity_kind, result_code, session_id,
   miniapp_version, platform, created_at)
  VALUES ('host-http-transfer-phone-event', ?, ?, 'admin', 'FORMAL_LOGIN_SUCCESS',
    'host-http-transfer-phone-session', 'http-test', 'weapp', ?)`)
  .run(CANONICAL_SUPER_ADMIN_ID, SUPER_ADMIN_PHONE, currentTime);

const actor = {
  userId: CANONICAL_SUPER_ADMIN_ID,
  deviceId: 'http-host-device',
  authorizationId: 'authorization-http-host',
  sessionId: 'http-source-session',
  activeRole: 'super_admin',
  eligibleRoles: ['super_admin'],
  authVersion: 1,
  credentialVersion: 1,
  userApproved: true,
  deviceActive: true,
  deviceTrusted: true,
  deviceOwnerUserId: CANONICAL_SUPER_ADMIN_ID,
};
const targetActor = {
  ...actor,
  deviceId: 'http-target-device',
  authorizationId: 'authorization-http-target',
  sessionId: 'http-target-session',
};
for (const context of [actor, targetActor]) {
  db.prepare(`INSERT INTO desktop_sessions
    (sid,user_id,device_id,authorization_id,active_role,eligible_roles_json,auth_version,
     credential_version,status,issued_at,expires_at,row_version,created_at,updated_at)
    VALUES (?,?,?,?, 'super_admin','["super_admin"]',1,1,'active',?,
      '2027-07-18T02:00:00.000Z',1,?,?)`)
    .run(context.sessionId, context.userId, context.deviceId, context.authorizationId,
      currentTime, currentTime, currentTime);
}

const { createPrimaryHostIdentityService } = require('../services/primaryHostIdentityService');
const hostService = createPrimaryHostIdentityService({
  db,
  now: () => new Date(currentTime),
  localEvidenceProvider: () => ({
    runtimeNodeRole: 'primary-host',
    dbInstanceDigest: '1'.repeat(64),
    schemaVersion: 3110,
    storeId: 'http-store-1',
    dbAuthorityId: 'http-db-authority-1',
    quickCheck: 'ok',
  }),
});

const { createDesktopIdentityRouter } = require('./desktopIdentity');
const databaseModule = require('../database');
databaseModule.getInstance = () => databaseService;
delete require.cache[require.resolve('./cloudRelay')];
const cloudRelayRouter = require('./cloudRelay');

const app = express();
app.use(express.json());
app.use('/api/desktop-identity', createDesktopIdentityRouter({
  db,
  primaryHostIdentityService: hostService,
  authenticateDesktop: token => {
    if (token === 'online-host-session') return actor;
    if (token === 'online-target-session') return targetActor;
    throw Object.assign(new Error('DESKTOP_SESSION_REQUIRED'), { code: 'DESKTOP_SESSION_REQUIRED' });
  },
  miniappIdentityService: (() => {
    const loginEvents = ['host-http-phone-event', 'host-http-transfer-phone-event'];
    return {
      loginWithVerifiedWechat: () => ({
      user: { id: CANONICAL_SUPER_ADMIN_ID },
      loginEventId: loginEvents.shift(),
    }),
    };
  })(),
  resolveWechatIdentity: async () => ({ openid: 'host-http-openid', unionid: null }),
  resolveWechatPhoneNumber: async () => SUPER_ADMIN_PHONE,
  createDesktopAuthorizationUrlLink: async () => {
    const error = new Error('url link permission unavailable');
    error.code = 'WECHAT_URL_LINK_FAILED';
    error.wechatErrcode = 85407;
    throw error;
  },
  createDesktopAuthorizationQrCode: async ({ challengeId }) => `data:image/jpeg;base64,${Buffer.from(`host-${challengeId}`).toString('base64')}`,
  localBridgeSecret: 'electron-local-bridge-secret-for-http-tests',
}));
app.use('/api/cloud', cloudRelayRouter);

(async () => {
  const server = app.listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const desktopHeaders = { authorization: 'Bearer online-host-session', 'content-type': 'application/json' };
  const targetHeaders = {
    authorization: 'Bearer online-target-session',
    'content-type': 'application/json',
  };
  const call = (pathname, options = {}) => fetch(origin + pathname, {
    ...options,
    signal: AbortSignal.timeout(3000),
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  try {
    const forbidden = await call('/api/desktop-identity/primary-host/challenges/start', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({ operation: 'bootstrap', targetDeviceId: 'http-host-device', userId: CANONICAL_SUPER_ADMIN_ID }),
    });
    assert.strictEqual(forbidden.status, 400);
    assert.strictEqual((await forbidden.json()).code, 'DESKTOP_IDENTITY_INPUT_FORBIDDEN');

    const startedResponse = await call('/api/desktop-identity/primary-host/challenges/start', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({ operation: 'bootstrap', targetDeviceId: 'http-host-device' }),
    });
    assert.strictEqual(startedResponse.status, 200);
    const started = (await startedResponse.json()).data.challenge;
    assert.strictEqual(started.status, 'pending_phone');
    assert.strictEqual(started.qrValue, null);
    assert.ok(started.qrImageDataUrl.startsWith('data:image/jpeg;base64,'));
    assert.strictEqual(started.qrEntryMode, 'mini-program-code');

    const publicRead = await call(`/api/desktop-identity/challenges/${started.id}/public`);
    assert.strictEqual(publicRead.status, 200);
    const publicChallenge = (await publicRead.json()).data.challenge;
    assert.deepStrictEqual(Object.keys(publicChallenge).sort(), [
      'createdAt', 'deviceName', 'expiresAt', 'id', 'keyFingerprintSummary', 'operation', 'purpose', 'status',
      'rowVersion',
    ].sort());

    const confirmedResponse = await call(`/api/desktop-identity/challenges/${started.id}/confirm`, {
      method: 'POST', body: JSON.stringify({ code: 'wechat-code', phoneCode: 'phone-code', expectedRowVersion: started.rowVersion }),
    });
    assert.strictEqual(confirmedResponse.status, 200);
    const confirmed = (await confirmedResponse.json()).data.challenge;
    assert.strictEqual(confirmed.status, 'identity_verified');

    const blockedEvidence = await call('/api/desktop-identity/primary-host/local-evidence', {
      method: 'POST', body: JSON.stringify({ purpose: 'bootstrap' }),
    });
    assert.strictEqual(blockedEvidence.status, 401);
    const evidenceResponse = await call('/api/desktop-identity/primary-host/local-evidence', {
      method: 'POST',
      headers: {
        ...desktopHeaders,
        'x-gewu-electron-local-bridge': 'electron-local-bridge-secret-for-http-tests',
      },
      body: JSON.stringify({ purpose: 'bootstrap' }),
    });
    assert.strictEqual(evidenceResponse.status, 200);
    const evidence = (await evidenceResponse.json()).data.evidence;
    assert.strictEqual(evidence.storeId, 'http-store-1');
    const retiredReceiptEndpoint = await call('/api/desktop-identity/primary-host/local-receipts', {
      method: 'POST', headers: desktopHeaders, body: JSON.stringify({}),
    });
    assert.strictEqual(retiredReceiptEndpoint.status, 410);
    const bootstrapManifest = buildPrimaryHostOperationManifest({
      operation: 'bootstrap',
      deviceId: actor.deviceId,
      challengeId: started.id,
      targetGeneration: 1,
      credentialStage: credentialStage('bootstrap', started.id, actor.deviceId, 1),
      recoveryDeliveryKey: recoveryDeliveryPublicKey('bootstrap'),
    });
    const receipt = createPrimaryHostLocalReceipt({
      operation: 'bootstrap',
      challengeId: started.id,
      identity: {
        userId: actor.userId,
        deviceId: actor.deviceId,
        authorizationId: actor.authorizationId,
        credentialVersion: actor.credentialVersion,
      },
      evidence,
      physicalConfirmation: PHYSICAL_CONFIRMATION,
      operationManifest: bootstrapManifest,
      now: () => new Date(currentTime),
    });
    const localReceipt = {
      receipt,
      signature: crypto.sign(
        null,
        Buffer.from(primaryHostReceiptSigningPayload(receipt), 'utf8'),
        deviceKeyPair.privateKey
      ).toString('base64'),
    };

    const bootstrapWithoutDeliveryKey = await call('/api/desktop-identity/primary-host/bootstrap', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({
        challengeId: started.id,
        expectedChallengeRowVersion: confirmed.rowVersion,
        localReceipt,
        operationManifest: bootstrapManifest,
      }),
    });
    assert.strictEqual(bootstrapWithoutDeliveryKey.status, 400);
    assert.strictEqual(
      (await bootstrapWithoutDeliveryKey.json()).code,
      'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED'
    );
    const bootstrapResponse = await call('/api/desktop-identity/primary-host/bootstrap', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({
        challengeId: started.id,
        expectedChallengeRowVersion: confirmed.rowVersion,
        localReceipt,
        operationManifest: bootstrapManifest,
        recoveryDeliveryKey: recoveryDeliveryPublicKey('bootstrap'),
      }),
    });
    assert.strictEqual(bootstrapResponse.status, 200);
    const bootstrap = (await bootstrapResponse.json()).data;
    assert.strictEqual(bootstrap.epoch.generation, 1);
    assert.strictEqual(Object.hasOwn(bootstrap, 'hostCredential'), false);
    assert.strictEqual(Object.hasOwn(bootstrap, 'recoveryPackage'), false);
    const bootstrapRecoveryPackage = decryptRecoveryDelivery(
      bootstrap,
      'bootstrap',
      actor.deviceId
    );
    assert.ok(bootstrapRecoveryPackage.recoveryCode);

    const verifiedAdoptionResponse = await call('/api/desktop-identity/primary-host/credentials/verify', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({
        epochId: bootstrap.epoch.id,
        deviceId: bootstrap.epoch.deviceId,
        generation: bootstrap.epoch.generation,
        credential: stagedHostCredentials.bootstrap,
      }),
    });
    assert.strictEqual(verifiedAdoptionResponse.status, 200);
    const verifiedAdoption = (await verifiedAdoptionResponse.json()).data;
    assert.strictEqual(verifiedAdoption.epoch.id, bootstrap.epoch.id);
    assert.ok(!JSON.stringify(verifiedAdoption).includes(stagedHostCredentials.bootstrap));
    const rejectedAdoption = await call('/api/desktop-identity/primary-host/credentials/verify', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({
        epochId: bootstrap.epoch.id,
        deviceId: bootstrap.epoch.deviceId,
        generation: bootstrap.epoch.generation,
        credential: 'wrong-managed-host-credential',
      }),
    });
    assert.notStrictEqual(rejectedAdoption.status, 200);
    assert.strictEqual((await rejectedAdoption.json()).code, 'PRIMARY_HOST_CREDENTIAL_INVALID');

    const statusResponse = await call('/api/desktop-identity/primary-host/status', { headers: desktopHeaders });
    assert.strictEqual(statusResponse.status, 200);
    const status = (await statusResponse.json()).data;
    assert.strictEqual(status.activeEpoch.generation, 1);
    assert.ok(!JSON.stringify(status).includes(stagedHostCredentials.bootstrap));
    assert.ok(!JSON.stringify(status).includes(bootstrapRecoveryPackage.recoveryCode));
    assert.strictEqual(status.recoveryDeliveryPending, true);
    assert.strictEqual(status.pendingRecoveryDelivery.id, bootstrap.recoveryDelivery.id);

    const nonTargetPendingResponse = await call('/api/desktop-identity/primary-host/status', {
      headers: targetHeaders,
    });
    assert.strictEqual(nonTargetPendingResponse.status, 200);
    const nonTargetPending = (await nonTargetPendingResponse.json()).data;
    assert.strictEqual(nonTargetPending.recoveryDeliveryPending, true);
    assert.strictEqual(Object.hasOwn(nonTargetPending, 'pendingRecoveryDelivery'), false);

    const bootstrapAcknowledgement = {
      deliveryId: bootstrap.recoveryDelivery.id,
      epochId: bootstrap.recoveryDelivery.epochId,
      factorId: bootstrap.recoveryDelivery.factorId,
      recipientKeyFingerprint: bootstrap.recoveryDelivery.recipientKeyFingerprint,
      expectedRowVersion: bootstrap.recoveryDelivery.rowVersion,
      acknowledgementNonce: bootstrap.recoveryDelivery.ackNonce,
      acknowledgedAt: currentTime,
    };
    const bootstrapAckBody = {
      epochId: bootstrapAcknowledgement.epochId,
      factorId: bootstrapAcknowledgement.factorId,
      recipientKeyFingerprint: bootstrapAcknowledgement.recipientKeyFingerprint,
      expectedRowVersion: bootstrapAcknowledgement.expectedRowVersion,
      acknowledgementNonce: bootstrapAcknowledgement.acknowledgementNonce,
      acknowledgedAt: bootstrapAcknowledgement.acknowledgedAt,
      signature: signRecoveryDeliveryAcknowledgement({
        acknowledgement: bootstrapAcknowledgement,
        privateKeyPem: recoveryDeliveryKeyPairs.bootstrap.privateKeyPem,
      }),
    };
    const nonTargetAck = await call(
      `/api/desktop-identity/primary-host/recovery-deliveries/${bootstrap.recoveryDelivery.id}/acknowledge`,
      { method: 'POST', headers: targetHeaders, body: JSON.stringify(bootstrapAckBody) }
    );
    assert.strictEqual(nonTargetAck.status, 404);
    const bootstrapAckResponse = await call(
      `/api/desktop-identity/primary-host/recovery-deliveries/${bootstrap.recoveryDelivery.id}/acknowledge`,
      { method: 'POST', headers: desktopHeaders, body: JSON.stringify(bootstrapAckBody) }
    );
    assert.strictEqual(bootstrapAckResponse.status, 200);
    assert.strictEqual(
      (await bootstrapAckResponse.json()).data.recoveryDelivery.status,
      'acknowledged'
    );

    const legacyHeartbeat = await call('/api/cloud/host/heartbeat', {
      method: 'POST',
      headers: { 'x-gewu-host-token': process.env.GEWU_CLOUD_RELAY_HOST_TOKEN },
      body: JSON.stringify({ hostDeviceId: 'http-host-device' }),
    });
    assert.strictEqual(legacyHeartbeat.status, 403, 'legacy root host token must stop authorizing writes after bootstrap');

    const activeHostHeaders = {
      'x-gewu-host-device-id': 'http-host-device',
      'x-gewu-host-generation': '1',
      'x-gewu-host-credential': stagedHostCredentials.bootstrap,
    };
    assert.strictEqual((await call('/api/cloud/host/heartbeat', {
      method: 'POST', headers: activeHostHeaders,
      body: JSON.stringify({ hostDeviceId: 'http-host-device' }),
    })).status, 200);
    db.prepare(`UPDATE host_heartbeats SET status='online', updated_at='2026-07-18T00:30:00.000Z'
      WHERE host_device_id='http-host-device'`).run();
    const staleStatusResponse = await call('/api/desktop-identity/primary-host/status', { headers: desktopHeaders });
    const staleStatus = (await staleStatusResponse.json()).data;
    assert.strictEqual(staleStatus.activeEpoch.heartbeat.status, 'offline');
    assert.strictEqual(staleStatus.activeEpoch.heartbeat.updatedAt, '2026-07-18T00:30:00.000Z');
    assert.ok(staleStatus.activeEpoch.heartbeat.consecutiveFailures >= 3);

    const transferStartedResponse = await call('/api/desktop-identity/primary-host/challenges/start', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({ operation: 'transfer', targetDeviceId: 'http-target-device' }),
    });
    assert.strictEqual(transferStartedResponse.status, 200);
    const transferStarted = (await transferStartedResponse.json()).data.challenge;
    const transferConfirmedResponse = await call(
      `/api/desktop-identity/challenges/${transferStarted.id}/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({
          code: 'wechat-code-transfer', phoneCode: 'phone-code-transfer',
          expectedRowVersion: transferStarted.rowVersion,
        }),
      }
    );
    assert.strictEqual(transferConfirmedResponse.status, 200);
    const transferConfirmed = (await transferConfirmedResponse.json()).data.challenge;
    const beginTransferResponse = await call('/api/desktop-identity/primary-host/transfers', {
      method: 'POST', headers: desktopHeaders,
      body: JSON.stringify({
        challengeId: transferConfirmed.id,
        expectedChallengeRowVersion: transferConfirmed.rowVersion,
        expectedActiveEpochRowVersion: bootstrap.epoch.rowVersion,
      }),
    });
    assert.strictEqual(beginTransferResponse.status, 200);
    const pendingTransfer = (await beginTransferResponse.json()).data.transfer;
    assert.strictEqual(pendingTransfer.status, 'pending_validation');

    const transferStatusResponse = await call('/api/desktop-identity/primary-host/status', {
      headers: targetHeaders,
    });
    assert.strictEqual(transferStatusResponse.status, 200);
    const transferControlStatus = (await transferStatusResponse.json()).data;
    const changesBeforeLocalPreflight = db.prepare('SELECT total_changes() value').get().value;
    const localEvidenceResponse = await call('/api/desktop-identity/primary-host/local-evidence', {
      method: 'POST',
      headers: {
        ...targetHeaders,
        'x-gewu-electron-local-bridge': 'electron-local-bridge-secret-for-http-tests',
      },
      body: JSON.stringify({
        purpose: 'transfer',
        sourceGeneration: pendingTransfer.sourceGeneration,
        targetGeneration: pendingTransfer.targetGeneration,
      }),
    });
    const localEvidencePayload = await localEvidenceResponse.json();
    assert.strictEqual(
      localEvidenceResponse.status,
      200,
      `real loopback local evidence failed: ${localEvidencePayload.code || 'unknown'}`
    );
    const localPrepared = localEvidencePayload.data;
    assert.strictEqual(
      db.prepare('SELECT total_changes() value').get().value,
      changesBeforeLocalPreflight,
      'loopback backup preflight must execute zero database writes'
    );
    assert.strictEqual(localPrepared.localValidation.localPreflight.status, 'ok');
    assert.strictEqual(localPrepared.localValidation.localPreflight.actor.userId, targetActor.userId);
    assert.strictEqual(localPrepared.localValidation.localPreflight.actor.deviceId, targetActor.deviceId);
    assert.strictEqual(localPrepared.localValidation.localPreflight.actor.sessionId, targetActor.sessionId);
    const backupArtifact = localPrepared.localValidation.backup;
    assert.strictEqual(backupArtifact.authoritative, true);
    assert.match(backupArtifact.sha256, /^[a-f0-9]{64}$/);
    const backupPath = path.join(
      process.env.GEWU_LOCAL_CACHE_PATH,
      'primary-host-validation',
      backupArtifact.artifactName
    );
    assert.strictEqual(
      fs.readFileSync(backupPath).subarray(0, 16).toString('binary'),
      'SQLite format 3\0'
    );
    const backupDb = new (require('better-sqlite3'))(backupPath, { readonly: true, fileMustExist: true });
    try {
      assert.strictEqual(backupDb.pragma('quick_check', { simple: true }), 'ok');
      assert.strictEqual(backupDb.pragma('user_version', { simple: true }), 3110);
    } finally {
      backupDb.close();
    }
    const localManifest = buildPrimaryHostOperationManifest({
      operation: 'transfer',
      deviceId: targetActor.deviceId,
      transferId: pendingTransfer.id,
      sourceEpochId: pendingTransfer.sourceEpochId,
      challengeId: pendingTransfer.challengeId,
      sourceGeneration: pendingTransfer.sourceGeneration,
      targetGeneration: pendingTransfer.targetGeneration,
      localPrepared,
      controlStatus: transferControlStatus,
      credentialStage: credentialStage(
        'transfer', pendingTransfer.challengeId, targetActor.deviceId, pendingTransfer.targetGeneration
      ),
      recoveryDeliveryKey: recoveryDeliveryPublicKey('transfer'),
      now: new Date(currentTime),
    });
    const targetReceipt = createPrimaryHostLocalReceipt({
      operation: 'transfer',
      challengeId: pendingTransfer.challengeId,
      identity: targetActor,
      evidence: localPrepared.evidence,
      physicalConfirmation: PHYSICAL_CONFIRMATION,
      operationManifest: localManifest,
      now: () => new Date(currentTime),
    });
    const targetLocalReceipt = {
      receipt: targetReceipt,
      signature: crypto.sign(
        null,
        Buffer.from(primaryHostReceiptSigningPayload(targetReceipt), 'utf8'),
        targetDeviceKeyPair.privateKey
      ).toString('base64'),
    };
    const proofResponse = await call('/api/desktop-identity/primary-host/preflight-proofs', {
      method: 'POST', headers: targetHeaders,
      body: JSON.stringify({
        operation: 'transfer',
        challengeId: pendingTransfer.challengeId,
        transferId: pendingTransfer.id,
        sourceEpochId: pendingTransfer.sourceEpochId,
        sourceGeneration: pendingTransfer.sourceGeneration,
        targetGeneration: pendingTransfer.targetGeneration,
        operationManifest: localManifest,
        localReceipt: targetLocalReceipt,
      }),
    });
    assert.strictEqual(proofResponse.status, 200);
    const preflight = (await proofResponse.json()).data.preflight;
    assert.strictEqual(preflight.cloudPreflight.status, 'ok');
    assert.strictEqual(preflight.operationManifest.cloudPreflight.status, 'ok');
    const activationResponse = await call(
      `/api/desktop-identity/primary-host/transfers/${pendingTransfer.id}/activate`,
      {
        method: 'POST', headers: targetHeaders,
        body: JSON.stringify({
          expectedTransferRowVersion: pendingTransfer.rowVersion,
          localReceipt: targetLocalReceipt,
          validationManifest: preflight.operationManifest,
          preflightProof: { id: preflight.id, token: preflight.token },
          recoveryDeliveryKey: recoveryDeliveryPublicKey('transfer'),
        }),
      }
    );
    assert.strictEqual(activationResponse.status, 200);
    const activation = (await activationResponse.json()).data;
    assert.strictEqual(activation.epoch.generation, 2);
    assert.strictEqual(activation.epoch.deviceId, 'http-target-device');
    assert.strictEqual(Object.hasOwn(activation, 'hostCredential'), false);
    assert.strictEqual(Object.hasOwn(activation, 'recoveryPackage'), false);
    const transferRecoveryPackage = decryptRecoveryDelivery(
      activation,
      'transfer',
      targetActor.deviceId
    );
    assert.strictEqual(transferRecoveryPackage.epochId, activation.epoch.id);

    const verifiedTransferAdoptionResponse = await call('/api/desktop-identity/primary-host/credentials/verify', {
      method: 'POST', headers: targetHeaders,
      body: JSON.stringify({
        epochId: activation.epoch.id,
        deviceId: activation.epoch.deviceId,
        generation: activation.epoch.generation,
        credential: stagedHostCredentials.transfer,
      }),
    });
    assert.strictEqual(verifiedTransferAdoptionResponse.status, 200);

    const retiredGenerationHeaders = activeHostHeaders;
    const oldCredentialAtCurrentGenerationHeaders = {
      'x-gewu-host-device-id': 'http-target-device',
      'x-gewu-host-generation': '2',
      'x-gewu-host-credential': stagedHostCredentials.bootstrap,
    };
    const rejectedWrites = [
      ['/api/cloud/host/heartbeat', { hostDeviceId: 'http-host-device' }],
      ['/api/cloud/tasks/claim', { hostDeviceId: 'http-host-device' }],
      ['/api/cloud/snapshots/publish', { snapshotType: 'full', payload: {} }],
    ];
    for (const [pathname, body] of rejectedWrites) {
      assert.strictEqual((await call(pathname, {
        method: 'POST', headers: retiredGenerationHeaders, body: JSON.stringify(body),
      })).status, 403, `${pathname} must reject the retired generation and credential`);
      const currentDeviceBody = pathname.endsWith('/heartbeat') || pathname.endsWith('/claim')
        ? { ...body, hostDeviceId: 'http-target-device' }
        : body;
      assert.strictEqual((await call(pathname, {
        method: 'POST', headers: oldCredentialAtCurrentGenerationHeaders,
        body: JSON.stringify(currentDeviceBody),
      })).status, 403, `${pathname} must reject an old credential in the current generation context`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    databaseService.close();
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  console.log('primary host identity HTTP checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
