const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  createDesktopIdentityService,
  desktopExchangeSigningPayload,
  fingerprintPublicKey,
} = require('./desktopIdentityService');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

const baseTime = '2026-07-17T00:00:00.000Z';
let currentTime = baseTime;
const shortCodes = [123456, 123456, 234567, 345678, 456789, 567890, 678901, 789012, 890123];
let shortCodeIndex = 0;
const service = createDesktopIdentityService({
  db,
  now: function () { return new Date(currentTime); },
  randomInt: function () { return shortCodes[shortCodeIndex++]; },
});

const canonicalId = 'miniapp-admin-13732250653';
const otherUserId = 'approved-admin-other';

function insertApprovedUser(id, phone, role) {
  db.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, review_status,
     auth_version, deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, 'approved', 1, 0, ?, ?)`)
    .run(id, phone, id, role, baseTime, baseTime);
  db.prepare(`INSERT INTO user_role_grants
    (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
    VALUES (?, ?, NULL, NULL, 'active', 'test', ?, ?)`)
    .run(id, role, baseTime, baseTime);
}

function insertLoginEvent(id, userId, phone, createdAt, resultCode = 'FORMAL_LOGIN_SUCCESS') {
  db.prepare(`INSERT INTO miniapp_login_events
    (id, user_id, phone_normalized, identity_kind, result_code, session_id,
     miniapp_version, platform, created_at)
    VALUES (?, ?, ?, 'admin', ?, ?, 'test', 'weapp', ?)`)
    .run(id, userId, phone, resultCode, `session-${id}`, createdAt);
}

insertApprovedUser(canonicalId, '13732250653', 'super_admin');
insertApprovedUser(otherUserId, '13000000001', 'admin');

function generateDeviceKey() {
  const credential = generateDeviceCredential();
  return {
    publicKey: credential.publicKey,
    keyFingerprint: credential.keyFingerprint,
  };
}

function generateDeviceCredential() {
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
  const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return {
    privateKey: keyPair.privateKey,
    publicKey,
    keyFingerprint: crypto.createHash('sha256').update(publicKeyDer).digest('hex'),
  };
}

const primaryDeviceKey = generateDeviceCredential();
const { publicKey, keyFingerprint, privateKey } = primaryDeviceKey;
assert.strictEqual(fingerprintPublicKey(publicKey), keyFingerprint);

for (const table of ['desktop_identity_challenges', 'desktop_device_authorizations']) {
  assert.ok(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
    `${table} must exist`
  );
}
assert.ok(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_desktop_identity_active_short_code'"
).get());
assert.ok(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_desktop_identity_active_key_fingerprint'"
).get());

const started = service.startChallenge({
  deviceId: 'device-2',
  deviceName: 'Second PC',
  publicKey,
  keyFingerprint,
  purpose: 'register',
});
assert.strictEqual(started.status, 'pending_phone');
assert.strictEqual(started.shortCode, '123456');
assert.strictEqual(started.rowVersion, 1);
assert.ok(started.challengeSecret.length >= 32);

const miniappProjection = service.readMiniappChallenge(started.id);
assert.deepStrictEqual(Object.keys(miniappProjection).sort(), [
  'createdAt', 'deviceName', 'expiresAt', 'id', 'keyFingerprintSummary', 'purpose', 'rowVersion', 'status',
].sort());
assert.strictEqual(miniappProjection.keyFingerprintSummary, `${keyFingerprint.slice(0, 8)}…${keyFingerprint.slice(-4)}`);
assert.ok(!('deviceId' in miniappProjection));
assert.strictEqual(miniappProjection.rowVersion, 1);

const storedStarted = db.prepare('SELECT * FROM desktop_identity_challenges WHERE id=?').get(started.id);
assert.strictEqual(storedStarted.device_kind, 'desktop-client');
assert.strictEqual(storedStarted.key_fingerprint, keyFingerprint);
assert.strictEqual(storedStarted.challenge_token_hash.length, 64);
assert.notStrictEqual(storedStarted.challenge_token_hash, started.challengeSecret);
assert.ok(!JSON.stringify(storedStarted).includes(started.challengeSecret));
assert.strictEqual(storedStarted.public_key, publicKey);
assert.strictEqual(storedStarted.claimed_user_id, null);

assert.strictEqual(
  service.verifyChallengeSecret({ challengeId: started.id, challengeSecret: started.challengeSecret }).id,
  started.id
);
assert.throws(
  function () {
    service.verifyChallengeSecret({ challengeId: started.id, challengeSecret: 'wrong-secret-value' });
  },
  function (error) { return error && error.code === 'DESKTOP_CHALLENGE_SECRET_INVALID'; }
);

for (const forbidden of [
  { phone: '13732250653' },
  { userId: canonicalId },
  { role: 'super_admin' },
  { teacherId: 'teacher-self' },
  { isPrimaryHost: true },
  { primaryHost: true },
  { challengeSecret: 'client-selected' },
  { privateKey: 'must-never-leave-device' },
]) {
  const key = Object.keys(forbidden)[0];
  assert.throws(
    function () {
      service.startChallenge({
        deviceId: `forbidden-${key}`,
        deviceName: 'Forbidden PC',
        publicKey,
        keyFingerprint,
        purpose: 'register',
        ...forbidden,
      });
    },
    function (error) { return error && error.code === 'DESKTOP_IDENTITY_INPUT_FORBIDDEN'; },
    `${key} must be rejected`
  );
}
assert.throws(
  function () {
    service.startChallenge({
      deviceId: 'bad-fingerprint', deviceName: 'Bad fingerprint', publicKey,
      keyFingerprint: '0'.repeat(64), purpose: 'register',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_DEVICE_FINGERPRINT_MISMATCH'; }
);
assert.throws(
  function () {
    service.startChallenge({
      deviceId: 'bad-purpose', deviceName: 'Bad purpose', publicKey,
      keyFingerprint, purpose: 'primary-host',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_CHALLENGE_PURPOSE_INVALID'; }
);

currentTime = '2026-07-17T00:01:00.000Z';
insertLoginEvent('login-canonical-1', canonicalId, '13732250653', currentTime);
const confirmed = service.confirmVerifiedIdentity({
  challengeId: started.id,
  identity: { id: canonicalId },
  loginEventId: 'login-canonical-1',
  expectedRowVersion: 1,
});
assert.strictEqual(confirmed.status, 'identity_verified_pending_approval');
assert.strictEqual(confirmed.claimedUserId, canonicalId);
assert.strictEqual(confirmed.rowVersion, 2);
assert.ok(confirmed.authorizationId);

const authorization = db.prepare(
  'SELECT * FROM desktop_device_authorizations WHERE id=?'
).get(confirmed.authorizationId);
assert.strictEqual(authorization.device_id, 'device-2');
assert.strictEqual(authorization.user_id, canonicalId);
assert.strictEqual(authorization.status, 'pending');
assert.strictEqual(authorization.device_kind, 'desktop-client');
assert.strictEqual(authorization.key_fingerprint, keyFingerprint);
  assert.strictEqual(authorization.credential_version, 1);
  assert.strictEqual(authorization.last_phone_verified_at, currentTime);

  const approvedRegistration = service.approveChallenge({
    challengeId: started.id,
    actorContext: {
      activeRole: 'super_admin', userId: canonicalId, deviceId: 'approver-device', authTime: currentTime,
    },
    expectedRowVersion: confirmed.rowVersion,
  });
  const registrationSignature = crypto.sign(
    null,
    Buffer.from(desktopExchangeSigningPayload({
      challengeId: started.id,
      deviceId: 'device-2',
      rowVersion: approvedRegistration.rowVersion,
      challengeSecret: started.challengeSecret,
    }), 'utf8'),
    privateKey
  ).toString('base64');
  const pendingActivation = service.beginActivation({
    challengeId: started.id,
    challengeSecret: started.challengeSecret,
    signature: registrationSignature,
    expectedRowVersion: approvedRegistration.rowVersion,
  });
  assert.strictEqual(pendingActivation.authorization.status, 'pending');
  assert.strictEqual(
    db.prepare('SELECT status FROM desktop_device_authorizations WHERE id=?').get(confirmed.authorizationId).status,
    'pending',
    'challenge proof must not activate a device before its local vault receipt is finalized'
  );

  const idempotent = service.beginActivation({
    challengeId: started.id,
    challengeSecret: started.challengeSecret,
    signature: registrationSignature,
    expectedRowVersion: approvedRegistration.rowVersion,
  });
  assert.strictEqual(idempotent.authorization.id, confirmed.authorizationId);
  assert.strictEqual(idempotent.authorization.status, 'pending');
assert.strictEqual(
  db.prepare('SELECT COUNT(*) count FROM desktop_device_authorizations WHERE device_id=?').get('device-2').count,
  1
);
assert.throws(
  function () {
    service.startChallenge({
      deviceId: 'device-key-clone',
      deviceName: 'Cloned key PC',
      publicKey,
      keyFingerprint,
      purpose: 'register',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_DEVICE_KEY_ALREADY_REGISTERED'; },
  'one device key must not represent multiple independently revocable devices'
);

insertLoginEvent('login-other-1', otherUserId, '13000000001', currentTime);
assert.throws(
  function () {
    service.confirmVerifiedIdentity({
      challengeId: started.id,
      identity: { id: otherUserId },
      loginEventId: 'login-other-1',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_CHALLENGE_CLAIMANT_CONFLICT'; }
);
assert.strictEqual(
  db.prepare('SELECT claimed_user_id FROM desktop_identity_challenges WHERE id=?').get(started.id).claimed_user_id,
  canonicalId
);

currentTime = '2026-07-17T00:02:00.000Z';
const thirdDeviceKey = generateDeviceKey();
const collisionChallenge = service.startChallenge({
  deviceId: 'device-3', deviceName: 'Third PC', ...thirdDeviceKey, purpose: 'register',
});
assert.strictEqual(collisionChallenge.shortCode, '234567');
currentTime = '2026-07-17T00:02:01.000Z';
const fourthDeviceKey = generateDeviceKey();
const replayChallenge = service.startChallenge({
  deviceId: 'device-4', deviceName: 'Fourth PC', ...fourthDeviceKey, purpose: 'register',
});
currentTime = '2026-07-17T00:02:02.000Z';
insertLoginEvent('login-canonical-2', canonicalId, '13732250653', currentTime);
service.confirmVerifiedIdentity({
  challengeId: collisionChallenge.id,
  identity: { id: canonicalId },
  loginEventId: 'login-canonical-2',
});
assert.throws(
  function () {
    service.confirmVerifiedIdentity({
      challengeId: replayChallenge.id,
      identity: { id: canonicalId },
      loginEventId: 'login-canonical-2',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_PHONE_PROOF_REPLAYED'; }
);

currentTime = '2026-07-17T00:03:00.000Z';
const fifthDeviceKey = generateDeviceKey();
const staleChallenge = service.startChallenge({
  deviceId: 'device-5', deviceName: 'Fifth PC', ...fifthDeviceKey, purpose: 'register',
});
assert.throws(
  function () {
    service.confirmVerifiedIdentity({
      challengeId: staleChallenge.id,
      identity: { id: canonicalId },
      loginEventId: 'login-canonical-2',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_PHONE_PROOF_STALE'; }
);
insertLoginEvent('login-unrecognized', canonicalId, '13732250653', currentTime, 'UNRECOGNIZED_LOGIN_SUCCESS');
assert.throws(
  function () {
    service.confirmVerifiedIdentity({
      challengeId: staleChallenge.id,
      identity: { id: canonicalId },
      loginEventId: 'login-unrecognized',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_VERIFIED_LOGIN_EVENT_REQUIRED'; }
);
for (const forbiddenProof of [
  { phone: '13732250653' },
  { code: 'wechat-login-code' },
  { phoneCode: 'wechat-phone-code' },
  { openid: 'client-openid' },
  { userId: canonicalId },
]) {
  assert.throws(
    function () {
      service.confirmVerifiedIdentity({
        challengeId: staleChallenge.id,
        identity: { id: canonicalId },
        loginEventId: 'missing-login-event',
        ...forbiddenProof,
      });
    },
    function (error) { return error && error.code === 'DESKTOP_IDENTITY_INPUT_FORBIDDEN'; }
  );
}

const sixthDeviceKey = generateDeviceKey();
const staleVersionChallenge = service.startChallenge({
  deviceId: 'device-6', deviceName: 'Sixth PC', ...sixthDeviceKey, purpose: 'register',
});
currentTime = '2026-07-17T00:03:01.000Z';
insertLoginEvent('login-canonical-3', canonicalId, '13732250653', currentTime);
assert.throws(
  function () {
    service.confirmVerifiedIdentity({
      challengeId: staleVersionChallenge.id,
      identity: { id: canonicalId },
      loginEventId: 'login-canonical-3',
      expectedRowVersion: 99,
    });
  },
  function (error) { return error && error.code === 'DESKTOP_CHALLENGE_VERSION_STALE'; }
);
assert.strictEqual(
  db.prepare('SELECT status FROM desktop_identity_challenges WHERE id=?').get(staleVersionChallenge.id).status,
  'pending_phone'
);

currentTime = '2026-07-17T00:04:00.000Z';
const expiringService = createDesktopIdentityService({
  db,
  now: function () { return new Date(currentTime); },
  challengeTtlMs: 1000,
  randomInt: function () { return 901234; },
});
const expiredDeviceKey = generateDeviceKey();
const expiredChallenge = expiringService.startChallenge({
  deviceId: 'device-expired', deviceName: 'Expired PC', ...expiredDeviceKey, purpose: 'register',
});
currentTime = '2026-07-17T00:04:02.000Z';
insertLoginEvent('login-canonical-expired', canonicalId, '13732250653', currentTime);
assert.throws(
  function () {
    expiringService.confirmVerifiedIdentity({
      challengeId: expiredChallenge.id,
      identity: { id: canonicalId },
      loginEventId: 'login-canonical-expired',
    });
  },
  function (error) { return error && error.code === 'DESKTOP_CHALLENGE_EXPIRED'; }
);
assert.strictEqual(
  db.prepare('SELECT status FROM desktop_identity_challenges WHERE id=?').get(expiredChallenge.id).status,
  'expired'
);
assert.strictEqual(
  db.prepare('SELECT COUNT(*) count FROM desktop_device_authorizations WHERE device_id=?')
    .get('device-expired').count,
  0
);

currentTime = '2026-07-17T00:04:10.000Z';
const approvalExpiredDeviceKey = generateDeviceKey();
const approvalExpiredChallenge = expiringService.startChallenge({
  deviceId: 'device-approval-expired', deviceName: 'Approval Expired PC', ...approvalExpiredDeviceKey, purpose: 'register',
});
insertLoginEvent('login-canonical-approval-expired', canonicalId, '13732250653', currentTime);
const approvalExpiredConfirmed = expiringService.confirmVerifiedIdentity({
  challengeId: approvalExpiredChallenge.id,
  identity: { id: canonicalId },
  loginEventId: 'login-canonical-approval-expired',
});
assert.strictEqual(approvalExpiredConfirmed.status, 'identity_verified_pending_approval');
currentTime = '2026-07-17T00:04:12.000Z';
expiringService.readPublicChallenge(approvalExpiredChallenge.id);
assert.strictEqual(
  db.prepare('SELECT status FROM desktop_identity_challenges WHERE id=?').get(approvalExpiredChallenge.id).status,
  'expired'
);
assert.strictEqual(
  db.prepare('SELECT status FROM desktop_device_authorizations WHERE id=?').get(approvalExpiredConfirmed.authorizationId).status,
  'revoked',
  'an expired approval request must not leave a non-actionable pending device authorization behind'
);
db.prepare(`UPDATE desktop_device_authorizations
  SET status='pending', revoked_at=NULL, row_version=row_version+1
  WHERE id=?`).run(approvalExpiredConfirmed.authorizationId);
currentTime = '2026-07-17T00:04:13.000Z';
const retriedExpiredChallenge = expiringService.startChallenge({
  deviceId: 'device-approval-expired', deviceName: 'Approval Expired PC', ...approvalExpiredDeviceKey, purpose: 'register',
});
insertLoginEvent('login-canonical-approval-retry', canonicalId, '13732250653', currentTime);
const retriedExpiredConfirmed = expiringService.confirmVerifiedIdentity({
  challengeId: retriedExpiredChallenge.id,
  identity: { id: canonicalId },
  loginEventId: 'login-canonical-approval-retry',
});
assert.strictEqual(retriedExpiredConfirmed.authorizationId, approvalExpiredConfirmed.authorizationId,
  'a retry after expiration must reuse the revoked device record instead of violating unique device constraints');
assert.strictEqual(
  db.prepare('SELECT status FROM desktop_device_authorizations WHERE id=?').get(retriedExpiredConfirmed.authorizationId).status,
  'pending'
);

const originalResetCredential = generateDeviceCredential();
db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, approved_by_user_id, approved_by_device_id, approved_at,
   last_phone_verified_at, phone_reverify_due_at, credential_version, row_version,
   created_at, updated_at)
  VALUES (?, ?, ?, 'desktop-client', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`)
  .run(
    'authorization-password-reset',
    'device-password-reset',
    'Password Reset PC',
    canonicalId,
    originalResetCredential.publicKey,
    originalResetCredential.keyFingerprint,
    'initial-registration-password-reset',
    canonicalId,
    'approver-device',
    currentTime,
    currentTime,
    '2026-08-16T00:04:02.000Z',
    currentTime,
    currentTime
  );
const originalPrimaryHostResetCredential = generateDeviceCredential();
db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, approved_by_user_id, approved_by_device_id, approved_at,
   last_phone_verified_at, phone_reverify_due_at, credential_version, row_version,
   created_at, updated_at)
  VALUES (?, ?, ?, 'primary-host', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`)
  .run(
    'authorization-primary-host-password-reset',
    'device-primary-host-password-reset',
    'Primary Host Password Reset',
    canonicalId,
    originalPrimaryHostResetCredential.publicKey,
    originalPrimaryHostResetCredential.keyFingerprint,
    'initial-registration-primary-host-password-reset',
    canonicalId,
    'approver-device',
    currentTime,
    currentTime,
    '2026-08-16T00:04:02.000Z',
    currentTime,
    currentTime
  );
db.prepare(`INSERT INTO primary_host_operation_challenges
  (id, operation, requested_by_user_id, requested_by_device_id, target_device_id,
   status, expires_at, row_version, created_at, updated_at)
  VALUES (?, 'bootstrap', ?, 'bootstrap-device', ?, 'consumed', ?, 1, ?, ?)`)
  .run(
    'primary-host-bootstrap-password-reset',
    canonicalId,
    'device-primary-host-password-reset',
    '2026-08-16T00:04:02.000Z',
    currentTime,
    currentTime
  );
db.prepare(`INSERT INTO primary_host_epochs
  (id, generation, device_id, user_id, authorization_id, status, activation_reason,
   challenge_id, db_instance_digest, schema_version, store_id, db_authority_id,
   host_credential_hash, credential_version, row_version, created_at, updated_at, activated_at)
  VALUES (?, 1, ?, ?, ?, 'active', 'bootstrap', ?, 'test-db-digest', 1, 'test-store',
   'test-authority', 'test-credential-hash', 1, 1, ?, ?, ?)`)
  .run(
    'primary-host-epoch-password-reset',
    'device-primary-host-password-reset',
    canonicalId,
    'authorization-primary-host-password-reset',
    'primary-host-bootstrap-password-reset',
    currentTime,
    currentTime,
    currentTime
  );
const nextPrimaryHostResetCredential = generateDeviceCredential();
const primaryHostResetStarted = service.startChallenge({
  deviceId: 'device-primary-host-password-reset',
  deviceName: 'Primary Host Password Reset',
  deviceKind: 'primary-host',
  publicKey: nextPrimaryHostResetCredential.publicKey,
  keyFingerprint: nextPrimaryHostResetCredential.keyFingerprint,
  purpose: 'password_reset',
});
assert.strictEqual(
  primaryHostResetStarted.status,
  'pending_phone',
  'a primary host password reset must begin with a new manual phone verification'
);
currentTime = '2026-07-17T00:04:30.000Z';
insertLoginEvent('login-primary-host-reset-owner', canonicalId, '13732250653', currentTime);
const primaryHostResetConfirmed = service.confirmVerifiedIdentity({
  challengeId: primaryHostResetStarted.id,
  identity: { id: canonicalId },
  loginEventId: 'login-primary-host-reset-owner',
  expectedRowVersion: primaryHostResetStarted.rowVersion,
});
assert.strictEqual(
  primaryHostResetConfirmed.status,
  'approved_pending_exchange',
  'the active primary host owner must not need a second desktop to approve a local password reset'
);
assert.strictEqual(
  db.prepare('SELECT approved_by_user_id FROM desktop_device_authorizations WHERE id=?')
    .get('authorization-primary-host-password-reset').approved_by_user_id,
  canonicalId
);
const nextResetCredential = generateDeviceCredential();
const resetStarted = service.startChallenge({
  deviceId: 'device-password-reset',
  deviceName: 'Password Reset PC',
  publicKey: nextResetCredential.publicKey,
  keyFingerprint: nextResetCredential.keyFingerprint,
  purpose: 'password_reset',
});
assert.strictEqual(resetStarted.status, 'pending_phone');
assert.strictEqual(
  db.prepare('SELECT key_fingerprint FROM desktop_device_authorizations WHERE id=?')
    .get('authorization-password-reset').key_fingerprint,
  originalResetCredential.keyFingerprint,
  'starting password reset must not replace the committed device key'
);

currentTime = '2026-07-17T00:05:00.000Z';
insertLoginEvent('login-reset-wrong-owner', otherUserId, '13000000001', currentTime);
assert.throws(
  () => service.confirmVerifiedIdentity({
    challengeId: resetStarted.id,
    identity: { id: otherUserId },
    loginEventId: 'login-reset-wrong-owner',
    expectedRowVersion: resetStarted.rowVersion,
  }),
  error => error?.code === 'DESKTOP_PASSWORD_RESET_IDENTITY_MISMATCH'
);
assert.strictEqual(
  db.prepare('SELECT credential_version FROM desktop_device_authorizations WHERE id=?')
    .get('authorization-password-reset').credential_version,
  1
);

currentTime = '2026-07-17T00:05:01.000Z';
insertLoginEvent('login-reset-owner', canonicalId, '13732250653', currentTime);
const resetConfirmed = service.confirmVerifiedIdentity({
  challengeId: resetStarted.id,
  identity: { id: canonicalId },
  loginEventId: 'login-reset-owner',
  expectedRowVersion: resetStarted.rowVersion,
});
assert.strictEqual(resetConfirmed.authorizationId, 'authorization-password-reset');
assert.strictEqual(resetConfirmed.status, 'identity_verified_pending_approval');
const resetApproved = service.approveChallenge({
  challengeId: resetStarted.id,
  actorContext: {
    activeRole: 'super_admin',
    userId: canonicalId,
    deviceId: 'approver-device',
    authTime: currentTime,
  },
  expectedRowVersion: resetConfirmed.rowVersion,
});
const beforeResetExchange = db.prepare(
  'SELECT * FROM desktop_device_authorizations WHERE id=?'
).get('authorization-password-reset');
assert.strictEqual(beforeResetExchange.status, 'active');
assert.strictEqual(beforeResetExchange.key_fingerprint, originalResetCredential.keyFingerprint);
assert.strictEqual(beforeResetExchange.credential_version, 1);

const resetSignature = crypto.sign(
  null,
  Buffer.from(desktopExchangeSigningPayload({
    challengeId: resetStarted.id,
    deviceId: 'device-password-reset',
    rowVersion: resetApproved.rowVersion,
    challengeSecret: resetStarted.challengeSecret,
  }), 'utf8'),
  nextResetCredential.privateKey
).toString('base64');
const resetExchanged = service.exchangeChallenge({
  challengeId: resetStarted.id,
  challengeSecret: resetStarted.challengeSecret,
  signature: resetSignature,
  expectedRowVersion: resetApproved.rowVersion,
});
assert.strictEqual(resetExchanged.authorization.id, 'authorization-password-reset');
assert.strictEqual(resetExchanged.authorization.userId, canonicalId);
assert.strictEqual(resetExchanged.authorization.deviceId, 'device-password-reset');
assert.strictEqual(resetExchanged.authorization.keyFingerprint, nextResetCredential.keyFingerprint);
assert.strictEqual(resetExchanged.authorization.credentialVersion, 2);
assert.strictEqual(resetExchanged.authorization.status, 'active');
const resetExchangeRetry = service.exchangeChallenge({
  challengeId: resetStarted.id,
  challengeSecret: resetStarted.challengeSecret,
  signature: resetSignature,
  expectedRowVersion: resetApproved.rowVersion,
});
assert.strictEqual(resetExchangeRetry.authorization.id, resetExchanged.authorization.id);
assert.strictEqual(resetExchangeRetry.authorization.credentialVersion, 2);
assert.strictEqual(
  db.prepare(`SELECT COUNT(*) count FROM authorization_audit_log
    WHERE action='desktop_device_password_reset_exchanged' AND target_user_id=?`).get(canonicalId).count,
  1
);

db.prepare('DELETE FROM miniapp_login_events WHERE id=?').run('login-canonical-1');
assert.strictEqual(
  db.prepare('SELECT verified_login_event_id FROM desktop_identity_challenges WHERE id=?')
    .get(started.id).verified_login_event_id,
  null,
  'login-event retention must not be blocked by historical desktop challenges'
);

const allColumnNames = [
  ...db.prepare('PRAGMA table_info(desktop_identity_challenges)').all(),
  ...db.prepare('PRAGMA table_info(desktop_device_authorizations)').all(),
].map(function (column) { return column.name; });
for (const forbiddenColumn of ['wechat_code', 'phone_code', 'challenge_token', 'private_key']) {
  assert.ok(!allColumnNames.includes(forbiddenColumn), `${forbiddenColumn} must never be persisted`);
}

const primaryHostKey = crypto.generateKeyPairSync('ed25519');
const primaryHostPublicKey = primaryHostKey.publicKey.export({ type: 'spki', format: 'pem' });
const primaryHostStarted = service.startChallenge({
  deviceId: 'primary-host-registration', deviceName: 'Primary Host', publicKey: primaryHostPublicKey,
  keyFingerprint: fingerprintPublicKey(primaryHostPublicKey), purpose: 'register', deviceKind: 'primary-host',
});
assert.strictEqual(
  db.prepare('SELECT device_kind FROM desktop_identity_challenges WHERE id=?').get(primaryHostStarted.id).device_kind,
  'primary-host'
);

db.close();
console.log('desktop identity service tests passed');
