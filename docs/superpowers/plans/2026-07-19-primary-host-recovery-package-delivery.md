# Primary Host Recovery Package Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new primary-host bootstrap, planned transfer, and emergency recovery deliver its recovery package to the target Electron device through a crash-safe, target-device-only encrypted envelope that remains recoverable until the user explicitly acknowledges offline storage.

**Architecture:** Electron generates a dedicated RSA-3072 delivery key while staging the host credential and places only the public key and fingerprint in the signed operation manifest. The backend creates the recovery factor, encrypts the one-time package with AES-256-GCM, wraps the content key with RSA-OAEP-SHA256, stores the pending envelope through schema 3108, and accepts an acknowledgement only after a fresh RSA-PSS proof from the target device. Electron atomically adopts the host credential and decrypted package into `safeStorage`, exposes only metadata until an explicit reveal, acknowledges remotely before deleting local secrets, and blocks further high-risk host operations while delivery is pending.

**Tech Stack:** Node.js CommonJS, `node:crypto`, better-sqlite3, Express, Electron 28 `safeStorage`/IPC/contextBridge, React 18, TypeScript, Ant Design, assertion-based Node tests, isolated Playwright/Electron runtime checks.

---

## File responsibility map

- Create `backend/src/services/primaryHostRecoveryDeliveryProtocol.js`: canonical metadata, RSA delivery-key validation/generation, AES-GCM envelope sealing/opening, and RSA-PSS acknowledgement proof.
- Create `backend/src/services/primaryHostRecoveryDeliveryProtocol.test.js`: real cryptographic round trips and tamper/fingerprint/proof rejection.
- Create `backend/src/services/primaryHostRecoveryDeliveryService.js`: transactional pending-delivery persistence, target-only reads, alert ages, idempotency, and acknowledgement CAS cleanup.
- Create `backend/src/services/primaryHostRecoveryDeliveryService.test.js`: schema/service lifecycle and crash-window persistence checks.
- Modify `backend/src/schema.sql` and `backend/src/database.js`: schema 3108 `host_recovery_deliveries` table and indexes.
- Modify `backend/src/services/primaryHostIdentityService.js` and its test: prepare/store an envelope in the same activation transaction and never return a raw package.
- Modify `backend/src/routes/desktopIdentity.js` and `backend/src/routes/primaryHostIdentity.http.test.js`: delivery-key request contract, target-only status envelope, and acknowledgement endpoint.
- Modify `public/primaryHostOperationValidation.js` and its test: bind the delivery public key/fingerprint into the signed operation manifest.
- Modify `src/services/identityDeviceCenterPolicy.mjs` and its test: preserve delivery state in the policy snapshot and gate high-risk capabilities.
- Modify `public/primaryHostCredentialStore.js` and its test: version-3 safeStorage payload containing staged private key and pending decrypted recovery package.
- Modify `public/primaryHostRuntimeManager.js` and its test: decrypt/adopt/reveal/ack orchestration and restart recovery.
- Modify `public/electron.js`, `public/preload.js`, and `package.json`: delivery protocol wiring, privileged IPC, packaged-file and test-suite gates.
- Modify `src/pages/IdentityDeviceCenter.tsx`, `src/pages/IdentityDeviceCenter.css`, and `src/pages/IdentityDeviceCenter.test.js`: blocking recovery-delivery modal and high-risk-operation lock.
- Modify `docs/verification-2026-07-17-desktop-human-identity.md`, `docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md`, `scripts/check_deploy_readiness.js`, and their tests: Task 11 evidence and schema/protocol release gates.

### Task 1: Shared cryptographic delivery protocol

**Files:**
- Create: `backend/src/services/primaryHostRecoveryDeliveryProtocol.js`
- Create: `backend/src/services/primaryHostRecoveryDeliveryProtocol.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing real-crypto contract test**

Create the test with this executable contract:

```js
const assert = require('assert');
const {
  DELIVERY_PROTOCOL_VERSION,
  generateRecoveryDeliveryKeyPair,
  validateRecoveryDeliveryPublicKey,
  sealRecoveryPackage,
  openRecoveryPackage,
  signRecoveryDeliveryAcknowledgement,
  verifyRecoveryDeliveryAcknowledgement,
} = require('./primaryHostRecoveryDeliveryProtocol');

const keyPair = generateRecoveryDeliveryKeyPair();
assert.strictEqual(keyPair.protocolVersion, DELIVERY_PROTOCOL_VERSION);
assert.match(keyPair.publicKeyFingerprint, /^[a-f0-9]{64}$/);
assert.deepStrictEqual(validateRecoveryDeliveryPublicKey({
  publicKeyPem: keyPair.publicKeyPem,
  publicKeyFingerprint: keyPair.publicKeyFingerprint,
}), {
  publicKeyPem: keyPair.publicKeyPem,
  publicKeyFingerprint: keyPair.publicKeyFingerprint,
});

const packageValue = {
  factorId: 'factor-1',
  recoveryCode: 'offline-secret-code',
  epochId: 'epoch-2',
  generation: 2,
};
const delivery = {
  deliveryId: 'delivery-1',
  epochId: 'epoch-2',
  factorId: 'factor-1',
  userId: 'owner-1',
  deviceId: 'target-device',
  acknowledgementNonce: 'a'.repeat(64),
  issuedAt: '2026-07-19T00:00:00.000Z',
  rowVersion: 1,
};
const envelope = sealRecoveryPackage({
  ...delivery,
  recoveryPackage: packageValue,
  recipientPublicKeyPem: keyPair.publicKeyPem,
  recipientPublicKeyFingerprint: keyPair.publicKeyFingerprint,
});
assert.strictEqual(envelope.protocolVersion, DELIVERY_PROTOCOL_VERSION);
assert.strictEqual(JSON.stringify(envelope).includes('offline-secret-code'), false);
assert.deepStrictEqual(openRecoveryPackage({
  envelope,
  privateKeyPem: keyPair.privateKeyPem,
  expected: delivery,
}), packageValue);

const tampered = JSON.parse(JSON.stringify(envelope));
tampered.deviceId = 'attacker-device';
assert.throws(
  () => openRecoveryPackage({ envelope: tampered, privateKeyPem: keyPair.privateKeyPem, expected: delivery }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'
);

const otherKeyPair = generateRecoveryDeliveryKeyPair();
assert.throws(
  () => openRecoveryPackage({ envelope, privateKeyPem: otherKeyPair.privateKeyPem, expected: delivery }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED'
);
for (const field of ['ciphertext', 'authTag', 'wrappedKey']) {
  const corrupted = { ...envelope, [field]: Buffer.from(`corrupted-${field}`).toString('base64') };
  assert.throws(
    () => openRecoveryPackage({ envelope: corrupted, privateKeyPem: keyPair.privateKeyPem, expected: delivery }),
    error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED'
  );
}

const acknowledgement = { ...delivery, acknowledgedAt: '2026-07-19T00:01:00.000Z' };
const signature = signRecoveryDeliveryAcknowledgement({ acknowledgement, privateKeyPem: keyPair.privateKeyPem });
assert.strictEqual(verifyRecoveryDeliveryAcknowledgement({
  acknowledgement,
  signature,
  publicKeyPem: keyPair.publicKeyPem,
}), true);
assert.strictEqual(verifyRecoveryDeliveryAcknowledgement({
  acknowledgement: { ...acknowledgement, rowVersion: 2 },
  signature,
  publicKeyPem: keyPair.publicKeyPem,
}), false);

console.log('primary host recovery delivery protocol checks passed');
```

- [ ] **Step 2: Run the protocol test and verify RED**

Run: `node backend/src/services/primaryHostRecoveryDeliveryProtocol.test.js`

Expected: FAIL with `Cannot find module './primaryHostRecoveryDeliveryProtocol'`.

- [ ] **Step 3: Implement canonical key and acknowledgement primitives**

Create `primaryHostRecoveryDeliveryProtocol.js` with these exact constants, metadata fields, exports, and crypto choices:

```js
const crypto = require('crypto');

const DELIVERY_PROTOCOL_VERSION = 'primary-host-recovery-delivery/v1';
const ACK_PROTOCOL_VERSION = 'primary-host-recovery-delivery-ack/v1';
const METADATA_FIELDS = [
  'protocolVersion', 'deliveryId', 'epochId', 'factorId', 'userId', 'deviceId',
  'recipientPublicKeyFingerprint', 'acknowledgementNonce', 'issuedAt', 'rowVersion',
];
const ACK_FIELDS = [
  'protocolVersion', 'deliveryId', 'epochId', 'factorId', 'userId', 'deviceId',
  'acknowledgementNonce', 'acknowledgedAt', 'rowVersion',
];

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function selectRequired(input, fields, code) {
  const result = {};
  for (const field of fields) {
    const value = input?.[field];
    if (value === undefined || value === null || value === '') {
      throw protocolError(code, `Missing ${field}`);
    }
    result[field] = value;
  }
  return result;
}

function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

function validateRecoveryDeliveryPublicKey({ publicKeyPem, publicKeyFingerprint: expectedFingerprint }) {
  let key;
  try {
    key = crypto.createPublicKey(publicKeyPem);
  } catch (cause) {
    throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID', cause.message);
  }
  const details = key.asymmetricKeyDetails || {};
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  if (key.asymmetricKeyType !== 'rsa' || details.modulusLength !== 3072 || fingerprint !== expectedFingerprint) {
    throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID', 'Expected matching RSA-3072 SPKI key');
  }
  return { publicKeyPem, publicKeyFingerprint: fingerprint };
}

function generateRecoveryDeliveryKeyPair() {
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    publicKeyPem: pair.publicKey,
    privateKeyPem: pair.privateKey,
    publicKeyFingerprint: publicKeyFingerprint(pair.publicKey),
  };
}

function acknowledgementBytes(acknowledgement) {
  return Buffer.from(canonicalJson(selectRequired({
    ...acknowledgement,
    protocolVersion: ACK_PROTOCOL_VERSION,
  }, ACK_FIELDS, 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_INVALID')), 'utf8');
}

function signRecoveryDeliveryAcknowledgement({ acknowledgement, privateKeyPem }) {
  return crypto.sign('sha256', acknowledgementBytes(acknowledgement), {
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString('base64');
}

function verifyRecoveryDeliveryAcknowledgement({ acknowledgement, signature, publicKeyPem }) {
  try {
    return crypto.verify('sha256', acknowledgementBytes(acknowledgement), {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, Buffer.from(signature, 'base64'));
  } catch (_error) {
    return false;
  }
}
```

- [ ] **Step 4: Implement envelope sealing and opening in the same module**

Append this exact implementation before `module.exports`:

```js
function envelopeMetadata(input) {
  return selectRequired({
    ...input,
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
  }, METADATA_FIELDS, 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
}

function sealRecoveryPackage(input) {
  validateRecoveryDeliveryPublicKey({
    publicKeyPem: input.recipientPublicKeyPem,
    publicKeyFingerprint: input.recipientPublicKeyFingerprint,
  });
  const metadata = envelopeMetadata(input);
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
  cipher.setAAD(Buffer.from(canonicalJson(metadata), 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(canonicalJson(input.recoveryPackage), 'utf8'),
    cipher.final(),
  ]);
  return {
    ...metadata,
    wrappedKey: crypto.publicEncrypt({
      key: input.recipientPublicKeyPem,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, contentKey).toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function openRecoveryPackage({ envelope, privateKeyPem, expected }) {
  try {
    const metadata = envelopeMetadata(envelope);
    const expectedMetadata = envelopeMetadata({
      ...expected,
      recipientPublicKeyFingerprint: envelope.recipientPublicKeyFingerprint,
    });
    if (canonicalJson(metadata) !== canonicalJson(expectedMetadata)) {
      throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH', 'Envelope metadata mismatch');
    }
    const contentKey = crypto.privateDecrypt({
      key: privateKeyPem,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, Buffer.from(envelope.wrappedKey, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(canonicalJson(metadata), 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'));
  } catch (cause) {
    if (cause?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH') throw cause;
    throw protocolError('PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED', cause.message);
  }
}

module.exports = {
  DELIVERY_PROTOCOL_VERSION,
  ACK_PROTOCOL_VERSION,
  canonicalJson,
  generateRecoveryDeliveryKeyPair,
  validateRecoveryDeliveryPublicKey,
  sealRecoveryPackage,
  openRecoveryPackage,
  signRecoveryDeliveryAcknowledgement,
  verifyRecoveryDeliveryAcknowledgement,
};
```

- [ ] **Step 5: Run GREEN and wire the focused suite**

Run: `node backend/src/services/primaryHostRecoveryDeliveryProtocol.test.js`

Expected: PASS with `primary host recovery delivery protocol checks passed`.

Then prepend the command to `package.json` script `test:primary-host` and run:

`npm run test:primary-host`

Expected: PASS for the new protocol test and every existing primary-host test.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add -- backend/src/services/primaryHostRecoveryDeliveryProtocol.js backend/src/services/primaryHostRecoveryDeliveryProtocol.test.js package.json
git commit -m "自动发布 2026-07-19"
```

### Task 2: Schema 3108 and durable delivery lifecycle

**Files:**
- Create: `backend/src/services/primaryHostRecoveryDeliveryService.js`
- Create: `backend/src/services/primaryHostRecoveryDeliveryService.test.js`
- Modify: `backend/src/schema.sql`
- Modify: `backend/src/database.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing lifecycle test**

Create a better-sqlite3 memory database from `schema.sql` with this complete owner/device/epoch/factor setup, then exercise the lifecycle with a real delivery key:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  DELIVERY_PROTOCOL_VERSION,
  generateRecoveryDeliveryKeyPair,
  signRecoveryDeliveryAcknowledgement,
} = require('./primaryHostRecoveryDeliveryProtocol');
const { createPrimaryHostRecoveryDeliveryService } = require('./primaryHostRecoveryDeliveryService');

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
const createdAt = '2026-07-19T00:00:00.000Z';
db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
  VALUES ('owner-1', '13900000081', 'Owner', 'super_admin', 1, 1, 'approved', 0, ?, ?)`)
  .run(createdAt, createdAt);
db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
   credential_version, row_version, created_at, updated_at)
  VALUES ('authorization-1', 'target-device', 'Target', 'primary-host', 'owner-1',
    'device-public-key', ?, 'active', 'source-1', ?, '2026-08-19T00:00:00.000Z', 1, 1, ?, ?)`)
  .run('a'.repeat(64), createdAt, createdAt, createdAt);
db.prepare(`INSERT INTO primary_host_operation_challenges
  (id, operation, requested_by_user_id, requested_by_device_id, target_device_id,
   status, expires_at, row_version, created_at, updated_at, consumed_at)
  VALUES ('challenge-1', 'bootstrap', 'owner-1', 'target-device', 'target-device',
    'consumed', '2026-07-19T01:00:00.000Z', 2, ?, ?, ?)`)
  .run(createdAt, createdAt, createdAt);
db.prepare(`INSERT INTO primary_host_epochs
  (id, generation, device_id, user_id, authorization_id, status, activation_reason,
   challenge_id, db_instance_digest, schema_version, store_id, db_authority_id,
   host_credential_hash, credential_version, row_version, created_at, updated_at, activated_at)
  VALUES ('epoch-1', 1, 'target-device', 'owner-1', 'authorization-1', 'active', 'bootstrap',
    'challenge-1', ?, 3108, 'store-1', 'authority-1', ?, 1, 1, ?, ?, ?)`)
  .run('b'.repeat(64), 'c'.repeat(64), createdAt, createdAt, createdAt);
db.prepare(`INSERT INTO host_recovery_factors
  (id, epoch_id, user_id, device_id, generation, factor_hash, factor_salt,
   kdf_params_json, status, row_version, created_at, updated_at)
  VALUES ('factor-1', 'epoch-1', 'owner-1', 'target-device', 1, ?, ?, ?, 'active', 1, ?, ?)`)
  .run('d'.repeat(64), 'e'.repeat(32), JSON.stringify({ algorithm: 'scrypt' }), createdAt, createdAt);

const clock = { value: new Date(createdAt) };
let sequence = 0;
const service = createPrimaryHostRecoveryDeliveryService({
  db,
  now: () => new Date(clock.value),
  uuid: () => `delivery-or-audit-${++sequence}`,
  randomBytes: size => Buffer.alloc(size, 7),
});
const keyPair = generateRecoveryDeliveryKeyPair();
const prepared = service.prepare({
  epochId: 'epoch-1',
  factorId: 'factor-1',
  userId: 'owner-1',
  deviceId: 'target-device',
  recoveryPackage: {
    factorId: 'factor-1', recoveryCode: 'one-time-secret', epochId: 'epoch-1', generation: 1,
  },
  deliveryKey: {
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    publicKeyPem: keyPair.publicKeyPem,
    publicKeyFingerprint: keyPair.publicKeyFingerprint,
  },
});
service.storePrepared(prepared);

const stored = db.prepare('SELECT * FROM host_recovery_deliveries WHERE id=?').get(prepared.id);
assert.strictEqual(stored.status, 'pending');
assert.strictEqual(stored.row_version, 1);
assert.strictEqual(JSON.stringify(stored).includes('one-time-secret'), false);
assert.throws(
  () => service.getTargetDelivery({ epochId: 'epoch-1', userId: 'owner-1', deviceId: 'other-device' }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND'
);

assert.strictEqual(service.getTargetDelivery({
  epochId: 'epoch-1', userId: 'owner-1', deviceId: 'target-device',
}).attentionLevel, 'normal');
clock.value = new Date('2026-07-20T00:00:01.000Z');
assert.strictEqual(service.getTargetDelivery({
  epochId: 'epoch-1', userId: 'owner-1', deviceId: 'target-device',
}).attentionLevel, 'due_24h');
clock.value = new Date('2026-07-26T00:00:01.000Z');
assert.strictEqual(service.getTargetDelivery({
  epochId: 'epoch-1', userId: 'owner-1', deviceId: 'target-device',
}).attentionLevel, 'overdue_7d');
assert.ok(db.prepare('SELECT envelope_json FROM host_recovery_deliveries WHERE id=?').get(prepared.id).envelope_json);

const acknowledgement = {
  deliveryId: prepared.id,
  epochId: 'epoch-1',
  factorId: 'factor-1',
  acknowledgementNonce: prepared.acknowledgementNonce,
  acknowledgedAt: '2026-07-26T00:01:00.000Z',
  rowVersion: 1,
};
clock.value = new Date('2026-07-26T00:01:00.000Z');
const signature = signRecoveryDeliveryAcknowledgement({
  acknowledgement: { ...acknowledgement, userId: 'owner-1', deviceId: 'target-device' },
  privateKeyPem: keyPair.privateKeyPem,
});
assert.throws(
  () => service.acknowledge({
    actor: { userId: 'owner-1', deviceId: 'target-device' },
    acknowledgement,
    signature: Buffer.from('invalid-proof').toString('base64'),
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_PROOF_INVALID'
);
assert.deepStrictEqual(service.acknowledge({
  actor: { userId: 'owner-1', deviceId: 'target-device' }, acknowledgement, signature,
}), { deliveryId: prepared.id, status: 'acknowledged', rowVersion: 2 });

const cleared = db.prepare('SELECT * FROM host_recovery_deliveries WHERE id=?').get(prepared.id);
assert.strictEqual(cleared.envelope_json, null);
assert.strictEqual(cleared.recipient_public_key_pem, null);
assert.strictEqual(cleared.acknowledgement_nonce, null);
assert.deepStrictEqual(service.acknowledge({
  actor: { userId: 'owner-1', deviceId: 'target-device' }, acknowledgement, signature,
}), { deliveryId: prepared.id, status: 'acknowledged', rowVersion: 2 });
```

- [ ] **Step 2: Run the lifecycle test and verify RED**

Run: `node backend/src/services/primaryHostRecoveryDeliveryService.test.js`

Expected: FAIL because `host_recovery_deliveries` and the service module do not exist.

- [ ] **Step 3: Add schema 3108**

Add this table and indexes immediately after `host_recovery_factors`:

```sql
CREATE TABLE IF NOT EXISTS host_recovery_deliveries (
  id TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL,
  factor_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  recipient_key_fingerprint TEXT NOT NULL,
  recipient_public_key_pem TEXT,
  acknowledgement_nonce TEXT,
  envelope_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'acknowledged')),
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  acknowledged_at TEXT,
  FOREIGN KEY (epoch_id) REFERENCES primary_host_epochs(id),
  FOREIGN KEY (factor_id) REFERENCES host_recovery_factors(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_host_recovery_deliveries_epoch
  ON host_recovery_deliveries(epoch_id);

CREATE INDEX IF NOT EXISTS idx_host_recovery_deliveries_target_pending
  ON host_recovery_deliveries(user_id, device_id, status, created_at DESC);
```

Change only the default constant in `backend/src/database.js`:

```js
const SCHEMA_VERSION = 3108;
```

- [ ] **Step 4: Implement the delivery service**

Create `primaryHostRecoveryDeliveryService.js` with the following complete public behavior. Use `rowForTarget` for every envelope read so no other owner device receives ciphertext:

```js
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  DELIVERY_PROTOCOL_VERSION,
  sealRecoveryPackage,
  validateRecoveryDeliveryPublicKey,
  verifyRecoveryDeliveryAcknowledgement,
} = require('./primaryHostRecoveryDeliveryProtocol');

function serviceError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function createPrimaryHostRecoveryDeliveryService({
  db,
  now = () => new Date(),
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!db) throw new Error('db is required');

  function rowForTarget({ epochId, deliveryId, userId, deviceId }) {
    const row = deliveryId
      ? db.prepare('SELECT * FROM host_recovery_deliveries WHERE id=?').get(deliveryId)
      : db.prepare('SELECT * FROM host_recovery_deliveries WHERE epoch_id=?').get(epochId);
    if (!row || row.user_id !== userId || row.device_id !== deviceId) {
      throw serviceError('PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 'Recovery delivery not found', 404);
    }
    return row;
  }

  function publicStatus(row) {
    const ageMs = Math.max(0, now().getTime() - Date.parse(row.created_at));
    return {
      deliveryId: row.id,
      epochId: row.epoch_id,
      factorId: row.factor_id,
      status: row.status,
      rowVersion: row.row_version,
      recipientPublicKeyFingerprint: row.recipient_key_fingerprint,
      createdAt: row.created_at,
      acknowledgedAt: row.acknowledged_at || null,
      attentionLevel: ageMs >= 7 * 24 * 60 * 60 * 1000
        ? 'overdue_7d'
        : ageMs >= 24 * 60 * 60 * 1000 ? 'due_24h' : 'normal',
    };
  }

  function prepare({ epochId, factorId, userId, deviceId, recoveryPackage, deliveryKey }) {
    validateRecoveryDeliveryPublicKey(deliveryKey);
    if (deliveryKey.protocolVersion !== DELIVERY_PROTOCOL_VERSION) {
      throw serviceError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID', 'Unsupported delivery protocol', 400);
    }
    const id = uuid();
    const createdAt = now().toISOString();
    const acknowledgementNonce = randomBytes(32).toString('hex');
    const rowVersion = 1;
    const envelope = sealRecoveryPackage({
      deliveryId: id, epochId, factorId, userId, deviceId, acknowledgementNonce,
      issuedAt: createdAt, rowVersion, recoveryPackage,
      recipientPublicKeyPem: deliveryKey.publicKeyPem,
      recipientPublicKeyFingerprint: deliveryKey.publicKeyFingerprint,
    });
    return {
      id, epochId, factorId, userId, deviceId, acknowledgementNonce, rowVersion,
      createdAt, envelope, deliveryKey,
    };
  }

  function getTargetDelivery(input) {
    const row = rowForTarget(input);
    const result = publicStatus(row);
    if (row.status === 'pending') result.envelope = JSON.parse(row.envelope_json);
    return result;
  }

  function storePrepared(prepared) {
    db.prepare(`INSERT INTO host_recovery_deliveries
      (id, epoch_id, factor_id, user_id, device_id, protocol_version,
       recipient_key_fingerprint, recipient_public_key_pem, acknowledgement_nonce,
       envelope_json, status, row_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(
        prepared.id, prepared.epochId, prepared.factorId, prepared.userId, prepared.deviceId,
        DELIVERY_PROTOCOL_VERSION, prepared.deliveryKey.publicKeyFingerprint,
        prepared.deliveryKey.publicKeyPem, prepared.acknowledgementNonce,
        JSON.stringify(prepared.envelope), prepared.rowVersion, prepared.createdAt, prepared.createdAt
      );
    return getTargetDelivery({
      epochId: prepared.epochId, userId: prepared.userId, deviceId: prepared.deviceId,
    });
  }

  function getPendingSummary({ userId, deviceId }) {
    const row = db.prepare(`SELECT * FROM host_recovery_deliveries
      WHERE user_id=? AND device_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1`)
      .get(userId, deviceId);
    return row ? publicStatus(row) : null;
  }

  function hasPendingForUser(userId) {
    return Boolean(db.prepare(`SELECT 1 FROM host_recovery_deliveries
      WHERE user_id=? AND status='pending' LIMIT 1`).get(userId));
  }

  function acknowledge({ actor, acknowledgement, signature }) {
    const row = rowForTarget({ deliveryId: acknowledgement.deliveryId, ...actor });
    if (row.status === 'acknowledged') {
      return { deliveryId: row.id, status: 'acknowledged', rowVersion: row.row_version };
    }
    const signed = {
      deliveryId: row.id,
      epochId: row.epoch_id,
      factorId: row.factor_id,
      userId: row.user_id,
      deviceId: row.device_id,
      acknowledgementNonce: acknowledgement.acknowledgementNonce,
      acknowledgedAt: acknowledgement.acknowledgedAt,
      rowVersion: acknowledgement.rowVersion,
    };
    const fieldsMatch = signed.epochId === acknowledgement.epochId
      && signed.factorId === acknowledgement.factorId
      && signed.acknowledgementNonce === row.acknowledgement_nonce
      && signed.rowVersion === row.row_version;
    const skewMs = Math.abs(now().getTime() - Date.parse(signed.acknowledgedAt));
    if (!fieldsMatch || !Number.isFinite(skewMs) || skewMs > 5 * 60 * 1000) {
      throw serviceError('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT', 'Stale delivery acknowledgement');
    }
    if (!verifyRecoveryDeliveryAcknowledgement({
      acknowledgement: signed, signature, publicKeyPem: row.recipient_public_key_pem,
    })) {
      throw serviceError('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_PROOF_INVALID', 'Invalid delivery acknowledgement proof', 403);
    }
    const result = db.prepare(`UPDATE host_recovery_deliveries
      SET status='acknowledged', envelope_json=NULL, recipient_public_key_pem=NULL,
          acknowledgement_nonce=NULL, acknowledged_at=?, updated_at=?, row_version=row_version+1
      WHERE id=? AND status='pending' AND row_version=?`)
      .run(signed.acknowledgedAt, now().toISOString(), row.id, row.row_version);
    if (result.changes !== 1) {
      throw serviceError('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT', 'Concurrent acknowledgement conflict');
    }
    return { deliveryId: row.id, status: 'acknowledged', rowVersion: row.row_version + 1 };
  }

  return {
    prepare, storePrepared, getTargetDelivery, getPendingSummary, hasPendingForUser, acknowledge,
  };
}

module.exports = { createPrimaryHostRecoveryDeliveryService };
```

Use `authorization_audit_log` for delivery creation, failed acknowledgement, and successful acknowledgement. Add these helpers inside the service factory; never place the envelope, public key, nonce, signature, package, or recovery code in an audit value:

```js
const insertAudit = db.prepare(`INSERT INTO authorization_audit_log
  (id, actor_user_id, target_user_id, action, before_json, after_json, created_at)
  VALUES (?, NULL, NULL, ?, ?, ?, ?)`);

function auditDigest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function appendDeliveryAudit({ action, row, beforeStatus = null, afterStatus, errorCode = null }) {
  const summary = {
    deliveryIdDigest: auditDigest(row.id),
    epochIdDigest: auditDigest(row.epoch_id || row.epochId),
    recipientKeyFingerprintDigest: auditDigest(
      row.recipient_key_fingerprint || row.deliveryKey?.publicKeyFingerprint
    ),
    status: afterStatus,
    rowVersion: Number(row.row_version || row.rowVersion),
    errorCode,
  };
  insertAudit.run(
    uuid(),
    action,
    beforeStatus === null ? null : JSON.stringify({ ...summary, status: beforeStatus }),
    JSON.stringify(summary),
    now().toISOString()
  );
}
```

Call `appendDeliveryAudit` after `storePrepared` inserts a pending row. For ACK field/time conflict and invalid proof, write a failed audit with the stable error code immediately before throwing. Wrap the CAS update and successful audit insert in one `db.transaction`; if the CAS changes zero rows, write `PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT` after that transaction aborts. Extend the test with:

```js
const auditRows = db.prepare(`SELECT action, before_json, after_json
  FROM authorization_audit_log WHERE action LIKE 'primary_host_recovery_delivery_%'`).all();
assert.deepStrictEqual(auditRows.map(row => row.action), [
  'primary_host_recovery_delivery_created',
  'primary_host_recovery_delivery_ack_failed',
  'primary_host_recovery_delivery_acknowledged',
]);
const auditText = JSON.stringify(auditRows);
for (const forbidden of [
  'one-time-secret', 'envelope', 'wrappedKey', 'ciphertext', 'privateKey',
  'recoveryCode', 'acknowledgementNonce', 'signature',
]) {
  assert.strictEqual(auditText.includes(forbidden), false, `audit leaked ${forbidden}`);
}
```

- [ ] **Step 5: Run GREEN and schema checks**

Run:

```powershell
node backend/src/services/primaryHostRecoveryDeliveryService.test.js
node backend/src/databaseImportSafety.test.js
```

Expected: both commands PASS; the lifecycle test proves ciphertext survives seven days until acknowledgement and is cleared only by valid target proof.

- [ ] **Step 6: Add the service test to `test:primary-host` and commit**

Run: `npm run test:primary-host`

Expected: PASS.

```powershell
git add -- backend/src/services/primaryHostRecoveryDeliveryService.js backend/src/services/primaryHostRecoveryDeliveryService.test.js backend/src/schema.sql backend/src/database.js package.json
git commit -m "自动发布 2026-07-19"
```

### Task 3: Activation transactions, status recovery, and acknowledgement HTTP API

**Files:**
- Modify: `backend/src/services/primaryHostIdentityService.js`
- Modify: `backend/src/services/primaryHostIdentityService.test.js`
- Modify: `backend/src/routes/desktopIdentity.js`
- Modify: `backend/src/routes/primaryHostIdentity.http.test.js`

- [ ] **Step 1: Extend service and HTTP tests first**

For bootstrap, planned-transfer activation, and emergency recovery, provide a real `recoveryDeliveryKey` in the signed manifest and replace raw-package assertions with this contract:

```js
assert.strictEqual(Object.hasOwn(result, 'recoveryPackage'), false);
assert.strictEqual(result.recoveryDelivery.status, 'pending');
assert.strictEqual(result.recoveryDelivery.envelope.deviceId, targetDeviceId);
assert.strictEqual(JSON.stringify(result).includes(rawRecoveryCode), false);
const persisted = db.prepare('SELECT * FROM host_recovery_deliveries WHERE epoch_id=?').get(result.epoch.id);
assert.strictEqual(persisted.status, 'pending');
assert.ok(persisted.envelope_json);
```

Repeat each successful request with the same consumed challenge/transfer identity and assert the response keeps the same `epoch.id` and `recoveryDelivery.deliveryId`. Add these HTTP assertions:

```js
assert.strictEqual(bootstrapWithoutDeliveryKey.status, 400);
assert.strictEqual(bootstrapWithoutDeliveryKey.body.code, 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED');
assert.strictEqual(nonTargetStatus.body.data.recoveryDeliveryPending, true);
assert.strictEqual(Object.hasOwn(nonTargetStatus.body.data, 'recoveryDelivery'), false);
assert.strictEqual(targetStatus.body.data.recoveryDelivery.envelope.deviceId, targetDeviceId);
assert.strictEqual(acknowledgementResponse.status, 200);
assert.strictEqual(acknowledgementResponse.body.data.recoveryDelivery.status, 'acknowledged');
```

Also create a legacy fixture containing an already-active epoch but no delivery row. Its status must remain readable and must not fabricate a historical package:

```js
const legacyStatus = legacyService.getStatus(legacyActorContext);
assert.strictEqual(legacyStatus.activeEpoch.id, 'legacy-active-epoch');
assert.strictEqual(legacyStatus.recoveryDeliveryPending, false);
assert.strictEqual(Object.hasOwn(legacyStatus, 'recoveryDelivery'), false);
```

- [ ] **Step 2: Run RED for service and HTTP contracts**

Run:

```powershell
node backend/src/services/primaryHostIdentityService.test.js
node backend/src/routes/primaryHostIdentity.http.test.js
```

Expected: FAIL because activation still returns `recoveryPackage`, ignores `recoveryDeliveryKey`, and has no acknowledgement route.

- [ ] **Step 3: Integrate delivery preparation into the identity-service transaction**

Instantiate `createPrimaryHostRecoveryDeliveryService({ db, now: currentDate, uuid, randomBytes })` next to `recoveryFactors`. Change `prepareEpochSecrets` to accept the exact manifest used by each operation:

```js
function prepareEpochSecrets({ epochId, userId, deviceId, generation, credentialStage, manifest, actor }) {
  const staged = assertCredentialStage(credentialStage, { actor, generation });
  const deliveryKey = manifest?.recoveryDeliveryKey;
  if (!deliveryKey) {
    throw hostError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED');
  }
  const recovery = recoveryFactors.prepare({ epochId, userId, deviceId, generation });
  const delivery = recoveryDeliveries.prepare({
    epochId,
    factorId: recovery.recoveryPackage.factorId,
    userId,
    deviceId,
    recoveryPackage: recovery.recoveryPackage,
    deliveryKey,
  });
  return { hostCredentialHash: staged.commitment, recovery, delivery };
}
```

Pass `manifest: input.operationManifest`, `manifest: input.validationManifest`, or `manifest: input.evidence` at the three call sites. Inside each existing activation transaction, store both records in this order after epoch insertion:

```js
recoveryFactors.storePrepared(prepared.recovery);
recoveryDeliveries.storePrepared(prepared.delivery);
```

After the transaction, return only the persisted delivery view:

```js
const activatedEpoch = presentEpoch(db.prepare('SELECT * FROM primary_host_epochs WHERE id=?').get(epochId));
return Object.freeze({
  epoch: activatedEpoch,
  recoveryDelivery: recoveryDeliveries.getTargetDelivery({
    epochId: activatedEpoch.id,
    userId: actor.userId,
    deviceId: actor.deviceId,
  }),
});
```

Keep the operation-specific `alreadyActive` or `transfer` property in the corresponding result, but do not retain a `recoveryPackage` property.

- [ ] **Step 4: Make successful activation retries idempotent**

Use one helper for all three retry branches:

```js
function presentActivatedResult({ epochRow, actor, extra = {} }) {
  return Object.freeze({
    epoch: presentEpoch(epochRow),
    ...extra,
    recoveryDelivery: recoveryDeliveries.getTargetDelivery({
      epochId: epochRow.id,
      userId: actor.userId,
      deviceId: actor.deviceId,
    }),
  });
}
```

For bootstrap, return this when the active epoch belongs to the same target and challenge. For transfer, when the row is already `activated`, require its target user/device and locate the active epoch by `source_epoch_id` plus `activation_reason='transfer'`. For recovery, when the challenge is already consumed, require the active epoch to have that challenge, target actor, and `activation_reason='recovery'`. All mismatches continue to throw the existing state/mismatch codes.

- [ ] **Step 5: Add target-only delivery state and acknowledgement service methods**

Extend `getStatus` before its final return:

```js
const pendingDelivery = recoveryDeliveries.getPendingSummary({
  userId: actor.userId,
  deviceId: actor.deviceId,
});
const result = {
  activeEpoch,
  transfers: Object.freeze(transfers),
  history: Object.freeze(history),
  recoveryDeliveryPending: recoveryDeliveries.hasPendingForUser(actor.userId),
};
if (pendingDelivery) {
  result.recoveryDelivery = recoveryDeliveries.getTargetDelivery({
    deliveryId: pendingDelivery.deliveryId,
    userId: actor.userId,
    deviceId: actor.deviceId,
  });
}
return Object.freeze(result);
```

Expose an acknowledgement method that always derives actor identity from the authenticated context:

```js
function acknowledgeRecoveryDelivery(input = {}) {
  const actor = assertActor(input.actorContext);
  return recoveryDeliveries.acknowledge({
    actor: { userId: actor.userId, deviceId: actor.deviceId },
    acknowledgement: input.acknowledgement,
    signature: input.signature,
  });
}
```

- [ ] **Step 6: Add strict route body keys and the acknowledgement endpoint**

Define the request allowlist:

```js
const PRIMARY_HOST_RECOVERY_DELIVERY_ACK_KEYS = new Set([
  'epochId', 'factorId', 'acknowledgementNonce', 'acknowledgedAt', 'rowVersion', 'signature',
]);
```

Add this route below `/primary-host/status` so it uses the same V2 `authenticated` wrapper:

```js
router.post('/primary-host/recovery-deliveries/:deliveryId/acknowledge', authenticated(function (req, res, context) {
  assertBodyKeys(req.body, PRIMARY_HOST_RECOVERY_DELIVERY_ACK_KEYS);
  const recoveryDelivery = primaryHost().acknowledgeRecoveryDelivery({
    actorContext: context,
    acknowledgement: {
      deliveryId: req.params.deliveryId,
      epochId: req.body.epochId,
      factorId: req.body.factorId,
      acknowledgementNonce: req.body.acknowledgementNonce,
      acknowledgedAt: req.body.acknowledgedAt,
      rowVersion: req.body.rowVersion,
    },
    signature: req.body.signature,
  });
  return res.json({ success: true, data: { recoveryDelivery } });
}));
```

- [ ] **Step 7: Run focused GREEN and commit**

Run:

```powershell
node backend/src/services/primaryHostIdentityService.test.js
node backend/src/routes/primaryHostIdentity.http.test.js
npm run test:primary-host
```

Expected: all commands PASS, including raw-secret absence, retry idempotency, target-only envelope visibility, and valid acknowledgement cleanup.

```powershell
git add -- backend/src/services/primaryHostIdentityService.js backend/src/services/primaryHostIdentityService.test.js backend/src/routes/desktopIdentity.js backend/src/routes/primaryHostIdentity.http.test.js
git commit -m "自动发布 2026-07-19"
```

### Task 4: Bind the recipient key into the signed manifest and renderer API

**Files:**
- Modify: `public/primaryHostOperationValidation.js`
- Modify: `public/primaryHostOperationValidation.test.js`
- Modify: `src/services/identityDeviceCenterPolicy.mjs`
- Modify: `src/services/identityDeviceCenterPolicy.test.js`

- [ ] **Step 1: Write failing manifest and policy tests**

Generate a real key pair in `primaryHostOperationValidation.test.js` and assert that bootstrap, transfer, and recovery manifests contain exactly this public material:

```js
const recoveryDeliveryKey = {
  protocolVersion: keyPair.protocolVersion,
  publicKeyPem: keyPair.publicKeyPem,
  publicKeyFingerprint: keyPair.publicKeyFingerprint,
};
assert.deepStrictEqual(bootstrap.recoveryDeliveryKey, recoveryDeliveryKey);
assert.deepStrictEqual(transfer.recoveryDeliveryKey, recoveryDeliveryKey);
assert.deepStrictEqual(recovery.recoveryDeliveryKey, recoveryDeliveryKey);
assert.throws(
  () => buildPrimaryHostOperationManifest({
    operation: 'bootstrap', deviceId: 'new-host', targetGeneration: 1,
    credentialStage: bootstrapCredentialStage,
    recoveryDeliveryKey: { ...recoveryDeliveryKey, publicKeyFingerprint: '0'.repeat(64) },
  }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID'
);
```

In the policy test, add a host-control fixture with a target envelope and assert both pending states and all capability gates:

```js
assert.strictEqual(snapshot.host.recoveryDeliveryPending, true);
assert.strictEqual(snapshot.host.hasLocalRecoveryDelivery, true);
assert.strictEqual(snapshot.host.blocksHighRiskOperations, true);
assert.strictEqual(snapshot.host.canBootstrap, false);
assert.strictEqual(snapshot.host.canStartTransfer, false);
assert.strictEqual(snapshot.host.canActivateTransfer, false);
assert.strictEqual(snapshot.host.canRecover, false);
```

- [ ] **Step 2: Run RED**

Run:

```powershell
node public/primaryHostOperationValidation.test.js
node src/services/identityDeviceCenterPolicy.test.js
```

Expected: FAIL because manifests omit `recoveryDeliveryKey` and the policy lacks delivery state/capability gates.

- [ ] **Step 3: Normalize and attach the delivery key**

Import the shared validator and define one normalizer in `primaryHostOperationValidation.js`:

```js
const {
  DELIVERY_PROTOCOL_VERSION,
  validateRecoveryDeliveryPublicKey,
} = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol');

function normalizeRecoveryDeliveryKey(value) {
  if (value?.protocolVersion !== DELIVERY_PROTOCOL_VERSION) {
    throw operationError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID');
  }
  try {
    const validated = validateRecoveryDeliveryPublicKey(value);
    return Object.freeze({
      protocolVersion: DELIVERY_PROTOCOL_VERSION,
      publicKeyPem: validated.publicKeyPem,
      publicKeyFingerprint: validated.publicKeyFingerprint,
    });
  } catch (_error) {
    throw operationError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID');
  }
}
```

Add `recoveryDeliveryKey: normalizeRecoveryDeliveryKey(input.recoveryDeliveryKey)` to the bootstrap return and to `authorityManifest`. Do not accept a key from cloud status or any renderer-supplied field outside the value returned by the main-process stage.

- [ ] **Step 4: Project pending state and gate host capabilities**

Add these fields to the frozen `host` snapshot:

```js
recoveryDeliveryPending: Boolean(hostControl?.recoveryDeliveryPending),
recoveryDelivery: hostControl?.recoveryDelivery
  ? Object.freeze({ ...hostControl.recoveryDelivery })
  : null,
hasLocalRecoveryDelivery: Boolean(hostRuntimeStatus?.credential?.recoveryDelivery?.pending),
blocksHighRiskOperations: Boolean(
  hostControl?.recoveryDeliveryPending
  || hostRuntimeStatus?.credential?.recoveryDelivery?.pending
),
```

Gate `canBootstrap`, `canStartTransfer`, `canActivateTransfer`, and `canRecover` with `!blocksHighRiskOperations`, using one local boolean computed before the return. Do not add a renderer HTTP acknowledgement client: signing and the remote-first cleanup sequence belong exclusively to the Electron main process in Task 6.

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
node public/primaryHostOperationValidation.test.js
node src/services/identityDeviceCenterPolicy.test.js
npm run test:identity-device-center
```

Expected: PASS, with no private key or raw recovery package in either manifest or policy snapshot.

```powershell
git add -- public/primaryHostOperationValidation.js public/primaryHostOperationValidation.test.js src/services/identityDeviceCenterPolicy.mjs src/services/identityDeviceCenterPolicy.test.js
git commit -m "自动发布 2026-07-19"
```

### Task 5: safeStorage version 3 for staged keys and pending packages

**Files:**
- Modify: `public/primaryHostCredentialStore.js`
- Modify: `public/primaryHostCredentialStore.test.js`

- [ ] **Step 1: Write failing store tests for both crash windows**

Extend the existing test with a real generated delivery key. Verify that a fresh store instance can recover the staged private key before activation and the decrypted package after activation, while public status and the encrypted file never expose either secret:

```js
const deliveryKey = generateRecoveryDeliveryKeyPair();
const stagedWithKey = store.stage({
  stageId: 'transfer:challenge-delivery-1',
  operation: 'transfer',
  deviceId: 'desktop-host-a',
  targetGeneration: 2,
  hostCredential: 'locally-generated-host-secret-generation-2',
  recoveryDeliveryKey: deliveryKey,
});
assert.deepStrictEqual(stagedWithKey.recoveryDeliveryKey, {
  protocolVersion: deliveryKey.protocolVersion,
  publicKeyPem: deliveryKey.publicKeyPem,
  publicKeyFingerprint: deliveryKey.publicKeyFingerprint,
});
assert.strictEqual(JSON.stringify(stagedWithKey).includes(deliveryKey.privateKeyPem), false);
assert.strictEqual(fs.readFileSync(filePath, 'utf8').includes(deliveryKey.privateKeyPem), false);

const afterStageRestart = createPrimaryHostCredentialStore({
  filePath, safeStorage: mockSafeStorage(encryptionControl),
});
assert.strictEqual(afterStageRestart.read().recoveryDeliveryKey.privateKeyPem, deliveryKey.privateKeyPem);

afterStageRestart.commit({
  stageId: stagedWithKey.stageId,
  epoch: {
    id: 'epoch-2', generation: 2, deviceId: 'desktop-host-a', userId: 'canonical-owner',
    activatedAt: '2026-07-19T01:00:00.000Z',
  },
  pendingRecoveryDelivery: {
    deliveryId: 'delivery-2', epochId: 'epoch-2', factorId: 'factor-2',
    acknowledgementNonce: 'a'.repeat(64), rowVersion: 1,
    recipientPublicKeyFingerprint: deliveryKey.publicKeyFingerprint,
    recoveryPackage: {
      factorId: 'factor-2', recoveryCode: 'offline-only-code', epochId: 'epoch-2', generation: 2,
    },
  },
});
assert.strictEqual(JSON.stringify(afterStageRestart.status()).includes('offline-only-code'), false);
assert.deepStrictEqual(afterStageRestart.status().recoveryDelivery, {
  pending: true, deliveryId: 'delivery-2', epochId: 'epoch-2', factorId: 'factor-2', rowVersion: 1,
});

const afterAdoptionRestart = createPrimaryHostCredentialStore({
  filePath, safeStorage: mockSafeStorage(encryptionControl),
});
assert.strictEqual(
  afterAdoptionRestart.revealRecoveryPackage({ deliveryId: 'delivery-2' }).recoveryPackage.recoveryCode,
  'offline-only-code'
);
assert.throws(
  () => afterAdoptionRestart.clearRecoveryDelivery({ deliveryId: 'delivery-other' }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'
);
afterAdoptionRestart.clearRecoveryDelivery({ deliveryId: 'delivery-2' });
assert.deepStrictEqual(afterAdoptionRestart.status().recoveryDelivery, { pending: false });
assert.strictEqual(afterAdoptionRestart.read().credential, 'locally-generated-host-secret-generation-2');
assert.throws(
  () => afterAdoptionRestart.revealRecoveryPackage({ deliveryId: 'delivery-2' }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_PENDING'
);
```

- [ ] **Step 2: Run RED**

Run: `node public/primaryHostCredentialStore.test.js`

Expected: FAIL because staged values drop the delivery key and reveal/clear methods do not exist.

- [ ] **Step 3: Define version-3 normalized secret shapes**

Add a version constant and these normalizers. Keep version 1 and 2 readers intact for existing installations:

```js
const RECOVERY_DELIVERY_STORE_VERSION = 3;

function normalizeRecoveryDeliveryKey(value = {}) {
  const protocolVersion = requiredText(value.protocolVersion, 128);
  const publicKeyPem = requiredText(value.publicKeyPem, 8192);
  const privateKeyPem = requiredText(value.privateKeyPem, 16384);
  const publicKeyFingerprint = requiredText(value.publicKeyFingerprint, 64).toLowerCase();
  if (protocolVersion !== 'primary-host-recovery-delivery/v1'
    || !/^[a-f0-9]{64}$/.test(publicKeyFingerprint)
    || !publicKeyPem.includes('BEGIN PUBLIC KEY')
    || !privateKeyPem.includes('BEGIN PRIVATE KEY')) {
    throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID');
  }
  return Object.freeze({ protocolVersion, publicKeyPem, privateKeyPem, publicKeyFingerprint });
}

function normalizePendingRecoveryDelivery(value = {}, deliveryKey) {
  const rowVersion = Number(value.rowVersion);
  const recoveryPackage = value.recoveryPackage && typeof value.recoveryPackage === 'object'
    ? Object.freeze({ ...value.recoveryPackage })
    : null;
  const recipientPublicKeyFingerprint = requiredText(value.recipientPublicKeyFingerprint, 64).toLowerCase();
  if (!Number.isSafeInteger(rowVersion) || rowVersion < 1 || !recoveryPackage
    || recipientPublicKeyFingerprint !== deliveryKey.publicKeyFingerprint) {
    throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_INVALID');
  }
  return Object.freeze({
    deliveryId: requiredText(value.deliveryId, 128),
    epochId: requiredText(value.epochId, 128),
    factorId: requiredText(value.factorId, 128),
    acknowledgementNonce: requiredText(value.acknowledgementNonce, 128),
    rowVersion,
    recipientPublicKeyFingerprint,
    recoveryPackage,
  });
}
```

Version-3 staged records contain `recoveryDeliveryKey`; version-3 active records contain the key only while `pendingRecoveryDelivery` exists. Reject a pending delivery whose epoch differs from the active credential.

- [ ] **Step 4: Return only public key material and delivery metadata from status**

For a staged version-3 credential, add:

```js
recoveryDeliveryKey: Object.freeze({
  protocolVersion: credential.recoveryDeliveryKey.protocolVersion,
  publicKeyPem: credential.recoveryDeliveryKey.publicKeyPem,
  publicKeyFingerprint: credential.recoveryDeliveryKey.publicKeyFingerprint,
}),
```

For an active credential, always add:

```js
recoveryDelivery: credential.pendingRecoveryDelivery
  ? Object.freeze({
    pending: true,
    deliveryId: credential.pendingRecoveryDelivery.deliveryId,
    epochId: credential.pendingRecoveryDelivery.epochId,
    factorId: credential.pendingRecoveryDelivery.factorId,
    rowVersion: credential.pendingRecoveryDelivery.rowVersion,
  })
  : Object.freeze({ pending: false }),
```

Update every existing active-status expectation in `primaryHostCredentialStore.test.js` and `primaryHostRuntimeManager.test.js` to include `recoveryDelivery: { pending: false }`. Version-1 and version-2 files remain readable; only their public projection gains this nonsensitive field.

No status object may include `privateKeyPem`, `recoveryCode`, `recoveryPackage`, or the acknowledgement nonce.

- [ ] **Step 5: Make stage, commit, reveal, and clear atomic**

When `stage` receives `recoveryDeliveryKey`, write a version-3 staged record and include the public key projection in its return. Change `commit` to accept `pendingRecoveryDelivery`, validate it with the staged key, and write one version-3 active record containing the committed credential, delivery key, and pending package in the existing temporary-file-plus-rename operation:

```js
const pending = normalizePendingRecoveryDelivery(pendingRecoveryDelivery, existing.recoveryDeliveryKey);
if (pending.epochId !== String(epoch?.id || '')) {
  throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
}
const credential = normalizeStoredCredential({
  version: RECOVERY_DELIVERY_STORE_VERSION,
  state: 'active',
  stageId: existing.stageId,
  epochId: epoch.id,
  generation: epoch.generation,
  deviceId: epoch.deviceId,
  userId: epoch.userId,
  activatedAt: epoch.activatedAt,
  credential: existing.credential,
  recoveryDeliveryKey: existing.recoveryDeliveryKey,
  pendingRecoveryDelivery: pending,
});
writeEncrypted(credential);
```

Expose these main-process-only methods on the frozen store:

```js
revealRecoveryPackage({ deliveryId } = {}) {
  const credential = read();
  const pending = credential?.pendingRecoveryDelivery;
  if (!pending) throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_PENDING');
  if (pending.deliveryId !== requiredText(deliveryId, 128)) {
    throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
  }
  return Object.freeze({ ...pending, recoveryPackage: Object.freeze({ ...pending.recoveryPackage }) });
},
clearRecoveryDelivery({ deliveryId } = {}) {
  const credential = read();
  const pending = credential?.pendingRecoveryDelivery;
  if (!pending) return publicStatus(credential);
  if (pending.deliveryId !== requiredText(deliveryId, 128)) {
    throw credentialError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
  }
  const cleared = Object.freeze({
    version: RECOVERY_DELIVERY_STORE_VERSION,
    state: 'active',
    stageId: credential.stageId,
    epochId: credential.epochId,
    generation: credential.generation,
    deviceId: credential.deviceId,
    userId: credential.userId,
    activatedAt: credential.activatedAt,
    credential: credential.credential,
  });
  writeEncrypted(cleared);
  return publicStatus(cleared);
},
```

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
node public/primaryHostCredentialStore.test.js
npm run test:desktop-identity
```

Expected: PASS, including store reconstruction after both simulated exits and preservation of the active host credential after delivery cleanup.

```powershell
git add -- public/primaryHostCredentialStore.js public/primaryHostCredentialStore.test.js
git commit -m "自动发布 2026-07-19"
```

### Task 6: Runtime adoption, privileged reveal, remote-first acknowledgement, and IPC

**Files:**
- Modify: `public/primaryHostRuntimeManager.js`
- Modify: `public/primaryHostRuntimeManager.test.js`
- Modify: `public/electron.js`
- Modify: `public/preload.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing runtime-manager and packaging tests**

Extend the manager test with injected real protocol functions and an `acknowledgeDelivery` spy. Cover three process lifetimes: stage, cloud activation/adoption, and acknowledgement:

```js
const prepared = manager.stageAdoption({
  operation: 'transfer', challengeId: 'challenge-delivery-2', targetGeneration: 2,
});
assert.strictEqual(prepared.recoveryDeliveryKey.protocolVersion, DELIVERY_PROTOCOL_VERSION);
assert.strictEqual(Object.hasOwn(prepared.recoveryDeliveryKey, 'privateKeyPem'), false);

const envelope = sealRecoveryPackage({
  deliveryId: 'delivery-2', epochId: epoch.id, factorId: 'factor-2',
  userId: epoch.userId, deviceId: epoch.deviceId,
  acknowledgementNonce: 'b'.repeat(64), issuedAt: '2026-07-19T01:00:00.000Z', rowVersion: 1,
  recoveryPackage: {
    factorId: 'factor-2', recoveryCode: 'offline-code-2', epochId: epoch.id, generation: 2,
  },
  recipientPublicKeyPem: prepared.recoveryDeliveryKey.publicKeyPem,
  recipientPublicKeyFingerprint: prepared.recoveryDeliveryKey.publicKeyFingerprint,
});

await managerAfterActivationRestart.adopt({
  authorization: 'Bearer desktop-session',
  credentialStageId: prepared.stageId,
  epoch,
  recoveryDelivery: { status: 'pending', envelope },
});
assert.strictEqual(managerAfterAdoptionRestart.status().credential.recoveryDelivery.pending, true);
assert.strictEqual(
  managerAfterAdoptionRestart.revealRecoveryDelivery({ deliveryId: 'delivery-2' })
    .recoveryPackage.recoveryCode,
  'offline-code-2'
);

acknowledgementControl.fail = true;
await assert.rejects(
  () => managerAfterAdoptionRestart.acknowledgeRecoveryDelivery({
    authorization: 'Bearer desktop-session', deliveryId: 'delivery-2',
  }),
  /simulated acknowledgement outage/
);
assert.strictEqual(managerAfterAdoptionRestart.status().credential.recoveryDelivery.pending, true);

acknowledgementControl.fail = false;
acknowledgementControl.commitThenDrop = true;
await assert.rejects(
  () => managerAfterAdoptionRestart.acknowledgeRecoveryDelivery({
    authorization: 'Bearer desktop-session', deliveryId: 'delivery-2',
  }),
  /simulated response loss after remote commit/
);
assert.strictEqual(managerAfterAdoptionRestart.status().credential.recoveryDelivery.pending, true);

acknowledgementControl.commitThenDrop = false;
await managerAfterAdoptionRestart.acknowledgeRecoveryDelivery({
  authorization: 'Bearer desktop-session', deliveryId: 'delivery-2',
});
assert.strictEqual(managerAfterAdoptionRestart.status().credential.recoveryDelivery.pending, false);
assert.strictEqual(acknowledgements.length, 3);
assert.match(acknowledgements[2].signature, /^[A-Za-z0-9+/]+=*$/);
```

Also assert source wiring and packaging:

```js
assert.ok(electronSource.includes("require('../backend/src/services/primaryHostRecoveryDeliveryProtocol')"));
assert.ok(electronSource.includes("ipcMain.handle('primary-host:reveal-recovery-delivery'"));
assert.ok(electronSource.includes("ipcMain.handle('primary-host:acknowledge-recovery-delivery'"));
assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:reveal-recovery-delivery'"));
assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:acknowledge-recovery-delivery'"));
assert.ok(packageJson.build.files.some(entry => entry === 'backend/**/*'));
```

- [ ] **Step 2: Run RED**

Run: `node public/primaryHostRuntimeManager.test.js`

Expected: FAIL because stage has no key, adopt ignores the envelope, and reveal/acknowledge methods and IPC are absent.

- [ ] **Step 3: Generate and persist the delivery key at stage time**

Inject `generateRecoveryDeliveryKeyPair`, `openRecoveryPackage`, and `signRecoveryDeliveryAcknowledgement` into `createPrimaryHostRuntimeManager`. In `stageAdoption`, generate exactly one key for a new stage and pass it into the store:

```js
const recoveryDeliveryKey = generateRecoveryDeliveryKeyPair();
return credentialStore.stage({
  stageId,
  operation,
  deviceId: config.deviceId,
  targetGeneration: generation,
  hostCredential,
  recoveryDeliveryKey,
});
```

An idempotent call for the same stage must return the already-persisted public key rather than generating a replacement after `stage` reports an existing matching stage.

- [ ] **Step 4: Decrypt and atomically adopt the package**

After `verifyAdoption` validates the staged host credential, require a pending envelope and bind every metadata field to the verified epoch and staged key:

```js
const envelope = input.recoveryDelivery?.envelope;
if (!envelope || input.recoveryDelivery?.status !== 'pending') {
  throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_PENDING');
}
if (envelope.epochId !== verifiedEpoch.id
  || envelope.userId !== verifiedEpoch.userId
  || envelope.deviceId !== verifiedEpoch.deviceId
  || envelope.recipientPublicKeyFingerprint !== staged.recoveryDeliveryKey.publicKeyFingerprint) {
  throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
}
const recoveryPackage = openRecoveryPackage({
  envelope,
  privateKeyPem: staged.recoveryDeliveryKey.privateKeyPem,
  expected: {
    deliveryId: envelope.deliveryId,
    epochId: verifiedEpoch.id,
    factorId: envelope.factorId,
    userId: verifiedEpoch.userId,
    deviceId: verifiedEpoch.deviceId,
    acknowledgementNonce: envelope.acknowledgementNonce,
    issuedAt: envelope.issuedAt,
    rowVersion: envelope.rowVersion,
  },
});
if (recoveryPackage.epochId !== verifiedEpoch.id
  || recoveryPackage.factorId !== envelope.factorId
  || Number(recoveryPackage.generation) !== Number(verifiedEpoch.generation)) {
  throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
}
const credential = credentialStore.commit({
  stageId: staged.stageId,
  epoch: verifiedEpoch,
  pendingRecoveryDelivery: {
    deliveryId: envelope.deliveryId,
    epochId: envelope.epochId,
    factorId: envelope.factorId,
    acknowledgementNonce: envelope.acknowledgementNonce,
    rowVersion: envelope.rowVersion,
    recipientPublicKeyFingerprint: envelope.recipientPublicKeyFingerprint,
    recoveryPackage,
  },
});
```

Keep the existing managed-config reconciliation after this commit. Therefore exit before commit retains staged key; exit after commit retains active credential/package; and `initialize()` repairs managed config from the committed epoch.

- [ ] **Step 5: Implement privileged reveal and remote-first acknowledgement**

Add these manager methods. The acknowledgement function must not clear local state in a `finally` block or error path:

```js
function revealRecoveryDelivery({ deliveryId } = {}) {
  return credentialStore.revealRecoveryPackage({ deliveryId });
}

async function acknowledgeRecoveryDelivery({ authorization, deliveryId } = {}) {
  if (typeof acknowledgeDelivery !== 'function') {
    throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_ACKNOWLEDGER_REQUIRED');
  }
  const stored = credentialStore.read();
  const pending = credentialStore.revealRecoveryPackage({ deliveryId });
  const acknowledgement = {
    deliveryId: pending.deliveryId,
    epochId: pending.epochId,
    factorId: pending.factorId,
    userId: stored.userId,
    deviceId: stored.deviceId,
    acknowledgementNonce: pending.acknowledgementNonce,
    acknowledgedAt: new Date().toISOString(),
    rowVersion: pending.rowVersion,
  };
  const signature = signRecoveryDeliveryAcknowledgement({
    acknowledgement,
    privateKeyPem: stored.recoveryDeliveryKey.privateKeyPem,
  });
  const remote = await acknowledgeDelivery({ authorization, acknowledgement, signature });
  if (remote?.recoveryDelivery?.deliveryId !== pending.deliveryId
    || remote.recoveryDelivery.status !== 'acknowledged') {
    throw runtimeError('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_RESPONSE_INVALID');
  }
  const credential = credentialStore.clearRecoveryDelivery({ deliveryId: pending.deliveryId });
  const config = readRuntimeConfig(configPath, configOptions);
  lastState = Object.freeze({ config, credential });
  return Object.freeze({ ...credential, restartRequired: true });
}
```

- [ ] **Step 6: Wire Electron network and IPC without leaking the private key**

Import the shared protocol in `electron.js`, inject its three functions into the manager, and inject an `acknowledgeDelivery` function that validates a Bearer token, removes the path identifier from the JSON body, and posts to the pinned cloud URL:

```js
async function acknowledgePrimaryHostRecoveryDelivery(input = {}) {
  const authorization = String(input.authorization || '').trim();
  if (!authorization.startsWith('Bearer ') || authorization.length > 16384) {
    const error = new Error('PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED');
    error.code = 'PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED';
    throw error;
  }
  const { deliveryId, ...acknowledgementBody } = input.acknowledgement;
  const response = await fetch(
    `${MANAGED_CLOUD_BASE_URL}/api/desktop-identity/primary-host/recovery-deliveries/${encodeURIComponent(deliveryId)}/acknowledge`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ ...acknowledgementBody, signature: input.signature }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const payload = await response.json();
  if (!response.ok || payload?.success !== true || !payload?.data?.recoveryDelivery) {
    const error = new Error(payload?.code || 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_REJECTED');
    error.code = payload?.code || 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_REJECTED';
    throw error;
  }
  return payload.data;
}
```

Add main-process handlers:

```js
ipcMain.handle('primary-host:reveal-recovery-delivery', async (_event, input) => (
  getPrimaryHostRuntimeManager().revealRecoveryDelivery(input)
));
ipcMain.handle('primary-host:acknowledge-recovery-delivery', async (_event, input) => (
  getPrimaryHostRuntimeManager().acknowledgeRecoveryDelivery(input)
));
```

Expose only invocation methods from preload:

```js
revealRecoveryDelivery: input => ipcRenderer.invoke('primary-host:reveal-recovery-delivery', input),
acknowledgeRecoveryDelivery: input => ipcRenderer.invoke('primary-host:acknowledge-recovery-delivery', input),
```

- [ ] **Step 7: Run GREEN, syntax checks, and commit**

Run:

```powershell
node public/primaryHostRuntimeManager.test.js
node --check public/electron.js
node --check public/preload.js
npm run test:primary-host
```

Expected: PASS, including failed-network retention, successful remote-first clearing, restart recovery, and packaged shared protocol coverage.

```powershell
git add -- public/primaryHostRuntimeManager.js public/primaryHostRuntimeManager.test.js public/electron.js public/preload.js package.json
git commit -m "自动发布 2026-07-19"
```

### Task 7: Blocking device-center delivery UX

**Files:**
- Modify: `src/pages/IdentityDeviceCenter.tsx`
- Modify: `src/pages/IdentityDeviceCenter.css`
- Modify: `src/pages/IdentityDeviceCenter.test.js`

- [ ] **Step 1: Write failing source and policy-backed UI checks**

Replace the old raw-package source assertions with these security and recovery assertions:

```js
assert.strictEqual(source.includes('result.recoveryPackage'), false);
assert.ok(source.includes('primaryHostRuntime.revealRecoveryDelivery'));
assert.ok(source.includes('primaryHostRuntime.acknowledgeRecoveryDelivery'));
assert.ok(source.includes('snapshot.host.blocksHighRiskOperations'));
assert.ok(source.includes('closable={false}'));
assert.ok(decoded.includes('显示一次性恢复包'));
assert.ok(decoded.includes('我已离线保存，确认交付并重启'));
assert.ok(decoded.includes('恢复包尚未确认交付'));
assert.ok(style.includes('.recovery-delivery-secret'));
assert.ok(style.includes('user-select: all'));
```

Add a policy test showing that all four high-risk capability flags are false while either cloud or local pending state is true.

- [ ] **Step 2: Run RED**

Run:

```powershell
node src/pages/IdentityDeviceCenter.test.js
node src/services/identityDeviceCenterPolicy.test.js
```

Expected: FAIL because the page still consumes a raw server package, permits closing the modal, and restarts without remote acknowledgement.

- [ ] **Step 3: Replace raw-package state with local delivery state**

Use separate metadata and revealed-secret state:

```tsx
const [pendingRecoveryDelivery, setPendingRecoveryDelivery] = useState<any>(null);
const [revealedRecoveryPackage, setRevealedRecoveryPackage] = useState<any>(null);
```

After every successful `primaryHostRuntime.adopt`, use only the main-process result:

```tsx
const adopted = await primaryHostRuntime.adopt({
  authorization: session.authorization,
  credentialStageId: prepared.credentialStage.id,
  epoch: result.epoch,
  recoveryDelivery: result.recoveryDelivery,
});
setPendingRecoveryDelivery(adopted.recoveryDelivery);
setRevealedRecoveryPackage(null);
```

For transfer and recovery keep their existing operation-specific request inputs, but use the same adoption result code. Remove every `setRecoveryPackage(result.recoveryPackage)` and never copy a package from an HTTP result.

- [ ] **Step 4: Resume both pre-adoption and post-adoption crash states**

Change `resumeHostRuntimeAdoption` so a staged key resumes with the target envelope from cloud status, then opens delivery UI instead of immediately restarting:

```tsx
const adopted = await primaryHostRuntime.adopt({
  authorization: session.authorization,
  credentialStageId: stage.stageId,
  epoch: snapshot.host.activeEpoch,
  recoveryDelivery: snapshot.host.recoveryDelivery,
});
setPendingRecoveryDelivery(adopted.recoveryDelivery);
setRevealedRecoveryPackage(null);
await refresh();
```

After each `refresh`, if `hostRuntimeStatus.credential.recoveryDelivery.pending` is true, set `pendingRecoveryDelivery` from that metadata. This opens the same blocking flow after exit between safeStorage commit and first UI display.

- [ ] **Step 5: Add explicit reveal, copy, and remote-first confirmation actions**

Implement the three handlers without logging either returned value:

```tsx
const revealRecoveryDelivery = async () => {
  if (!pendingRecoveryDelivery?.deliveryId || !primaryHostRuntime?.revealRecoveryDelivery) return;
  const revealed = await primaryHostRuntime.revealRecoveryDelivery({
    deliveryId: pendingRecoveryDelivery.deliveryId,
  });
  setRevealedRecoveryPackage(revealed.recoveryPackage);
};

const copyRecoveryPackage = async () => {
  if (!revealedRecoveryPackage) return;
  await navigator.clipboard.writeText(JSON.stringify(revealedRecoveryPackage, null, 2));
  message.success('恢复包已复制，请保存到离线介质');
};

const acknowledgeRecoveryDeliveryAndRestart = async () => {
  if (!revealedRecoveryPackage || !pendingRecoveryDelivery?.deliveryId
    || !primaryHostRuntime?.acknowledgeRecoveryDelivery) return;
  await withOperation('primary-host:recovery-delivery:ack', async () => {
    await primaryHostRuntime.acknowledgeRecoveryDelivery({
      authorization: session.authorization,
      deliveryId: pendingRecoveryDelivery.deliveryId,
    });
    setPendingRecoveryDelivery(null);
    setRevealedRecoveryPackage(null);
    await primaryHostRuntime.restart();
  });
};
```

If acknowledgement fails, retain both states, show the mapped error, and leave the modal open.

- [ ] **Step 6: Render one non-closable delivery modal and a page-level warning**

Render this modal independently from the operation challenge modal:

```tsx
<Modal
  open={Boolean(pendingRecoveryDelivery)}
  title={'恢复包尚未确认交付'}
  footer={null}
  closable={false}
  maskClosable={false}
  keyboard={false}
>
  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert type="warning" showIcon message={'在确认前请勿关闭应用或开始另一项主机操作'} />
    {!revealedRecoveryPackage && (
      <Button type="primary" block onClick={() => void revealRecoveryDelivery()}>
        {'显示一次性恢复包'}
      </Button>
    )}
    {revealedRecoveryPackage && (
      <>
        <Input.TextArea
          className="recovery-delivery-secret"
          readOnly
          autoSize={{ minRows: 6 }}
          value={JSON.stringify(revealedRecoveryPackage, null, 2)}
        />
        <Button block onClick={() => void copyRecoveryPackage()}>{'复制恢复包'}</Button>
        <Button
          type="primary"
          block
          loading={operationKey === 'primary-host:recovery-delivery:ack'}
          onClick={() => void acknowledgeRecoveryDeliveryAndRestart()}
        >
          {'我已离线保存，确认交付并重启'}
        </Button>
      </>
    )}
  </Space>
</Modal>
```

When `snapshot.host.blocksHighRiskOperations` is true, render a warning card even on a non-target owner device. The target device shows the local modal; another device explains that the target must finish delivery. Do not provide a bypass or force-clear control.

- [ ] **Step 7: Add focused styling, run GREEN, and commit**

Add:

```css
.recovery-delivery-secret textarea {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  user-select: all;
  overflow-wrap: anywhere;
}
```

Run:

```powershell
node src/pages/IdentityDeviceCenter.test.js
node src/services/identityDeviceCenterPolicy.test.js
npm run test:identity-device-center
npm run typecheck
```

Expected: PASS; TypeScript accepts preload methods through the existing window bridge typing strategy, and the UI test proves there is no raw HTTP package path or close/restart bypass.

```powershell
git add -- src/pages/IdentityDeviceCenter.tsx src/pages/IdentityDeviceCenter.css src/pages/IdentityDeviceCenter.test.js src/services/identityDeviceCenterPolicy.mjs src/services/identityDeviceCenterPolicy.test.js
git commit -m "自动发布 2026-07-19"
```

### Task 8: Release gates, isolated Electron evidence, and Task 11 closure

**Files:**
- Modify: `scripts/check_deploy_readiness.js`
- Modify: `scripts/check_deploy_readiness.test.js`
- Modify: `docs/verification-2026-07-17-desktop-human-identity.md`
- Modify: `docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md`
- Modify: `package.json`
- Evidence only: `output/task11-primary-host-recovery-delivery/`

- [ ] **Step 1: Write failing deploy-gate assertions**

Add these marker expectations to `check_deploy_readiness.test.js`:

```js
for (const marker of [
  'host_recovery_deliveries',
  'primaryHostRecoveryDeliveryProtocol',
  'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED',
  'revealRecoveryDelivery',
  'acknowledgeRecoveryDelivery',
  'RECOVERY_DELIVERY_STORE_VERSION',
]) {
  assert.ok(source.includes(marker), `deploy readiness must gate recovery delivery marker: ${marker}`);
}
assert.strictEqual(source.includes("setRecoveryPackage(result.recoveryPackage)"), false);
```

Add an exported check invocation and assert `issues` is empty against the completed implementation:

```js
const recoveryDelivery = checks.checkPrimaryHostRecoveryDelivery();
assert.deepStrictEqual(
  recoveryDelivery.issues,
  [],
  `primary-host recovery delivery evidence failed: ${recoveryDelivery.issues.join(', ')}`
);
```

- [ ] **Step 2: Run the gate test and verify RED**

Run: `node scripts/check_deploy_readiness.test.js`

Expected: FAIL because `checkPrimaryHostRecoveryDelivery` and its markers do not exist.

- [ ] **Step 3: Implement a source/build release gate**

Add a check that reads exact files, reports one evidence row per boundary, and rejects both legacy plaintext paths:

```js
function checkPrimaryHostRecoveryDelivery() {
  const issues = [];
  const required = [
    ['backend/src/schema.sql', 'CREATE TABLE IF NOT EXISTS host_recovery_deliveries'],
    ['backend/src/database.js', 'const SCHEMA_VERSION = 3108'],
    ['backend/src/services/primaryHostRecoveryDeliveryProtocol.js', 'RSA_PKCS1_OAEP_PADDING'],
    ['backend/src/services/primaryHostRecoveryDeliveryProtocol.js', 'RSA_PKCS1_PSS_PADDING'],
    ['backend/src/services/primaryHostRecoveryDeliveryService.js', "status='acknowledged'"],
    ['public/primaryHostCredentialStore.js', 'RECOVERY_DELIVERY_STORE_VERSION'],
    ['public/primaryHostRuntimeManager.js', 'revealRecoveryDelivery'],
    ['public/primaryHostRuntimeManager.js', 'acknowledgeRecoveryDelivery'],
    ['src/pages/IdentityDeviceCenter.tsx', 'acknowledgeRecoveryDeliveryAndRestart'],
  ];
  const evidence = required.map(([file, marker]) => {
    const found = readText(file).includes(marker);
    if (!found) issues.push(`${file} missing ${marker}`);
    return Object.freeze({ key: `${file}:${marker}`, status: found ? 'present' : 'missing' });
  });
  const identityService = readText('backend/src/services/primaryHostIdentityService.js');
  const deviceCenter = readText('src/pages/IdentityDeviceCenter.tsx');
  if (identityService.includes('recoveryPackage: prepared.recovery.recoveryPackage')) {
    issues.push('primary-host activation still returns a plaintext recovery package');
  }
  if (deviceCenter.includes('setRecoveryPackage(result.recoveryPackage)')) {
    issues.push('renderer still consumes a plaintext HTTP recovery package');
  }
  return Object.freeze({ evidence: Object.freeze(evidence), issues: Object.freeze(issues) });
}
```

Include its issues in the existing identity failure aggregate, print its evidence, and export the function through the script's existing test export object.

Extend `checkIdentityBuildSafety` with the delivery UI markers and secret/log exclusions:

```js
for (const required of ['revealRecoveryDelivery', 'acknowledgeRecoveryDelivery']) {
  if (!aggregate.includes(required)) {
    issues.push(`desktop build is missing recovery delivery marker: ${required}`);
  }
}
for (const forbidden of [
  'offline-secret-code',
  'one-time-secret',
  'BEGIN PRIVATE KEY',
  'setRecoveryPackage(result.recoveryPackage)',
]) {
  if (aggregate.includes(forbidden)) {
    issues.push(`desktop build contains recovery delivery secret marker: ${forbidden}`);
  }
}
const recoverySources = [
  'backend/src/services/primaryHostRecoveryDeliveryProtocol.js',
  'backend/src/services/primaryHostRecoveryDeliveryService.js',
  'public/primaryHostCredentialStore.js',
  'public/primaryHostRuntimeManager.js',
  'public/electron.js',
  'src/pages/IdentityDeviceCenter.tsx',
].map(readText).join('\n');
if (/console\.(?:log|info|warn|error)\([^\n]*(?:envelope|wrappedKey|ciphertext|privateKey|recoveryPackage|recoveryCode|signature)/i.test(recoverySources)) {
  issues.push('recovery delivery source contains a secret-bearing log statement');
}
```

- [ ] **Step 4: Run focused and cross-surface automated verification**

Run these commands in order and retain exit code plus elapsed time in the verification document:

```powershell
npm run test:primary-host
npm run test:desktop-identity
npm run test:identity-device-center
npm run test:sync-identity
npm run typecheck
npm --prefix miniapp run typecheck
npm --prefix miniapp run build:weapp
npm run build
npm run check:desktop-identity-release
```

Expected: every command exits 0. The desktop build must contain the new delivery IPC/UI markers and no secret-bearing log statement.

- [ ] **Step 5: Run the full regression suite**

Run: `npm test`

Expected: exit 0 for all primary-host, human-identity, miniapp, sync, backend, UI-regression, and syntax checks. Investigate any failure before proceeding; do not weaken a gate or remove an existing user test.

- [ ] **Step 6: Verify the two crash windows under Electron 28**

First rebuild the native dependency for Electron and run the runtime-manager test under the actual Electron binary:

```powershell
npm run rebuild:electron
npx electron public/primaryHostRuntimeManager.test.js
```

Expected: PASS under Electron 28.3.3. The test must show:

1. process exit after cloud activation but before `adopt` leaves a staged private key and can decrypt the same server envelope after reconstruction;
2. process exit after safeStorage commit but before UI display leaves a pending local package and can reveal it after reconstruction;
3. acknowledgement network failure leaves the package; valid remote acknowledgement clears envelope server-side and package/private key locally;
4. the active host credential and managed epoch remain usable after local delivery cleanup.

- [ ] **Step 7: Inspect the built page in an isolated real Electron session**

Launch the current `build/index.html` through Electron 28 with a temporary `userData` directory and a loopback-only fixture; never use the real user profile or mutate the real cloud host epoch. Capture screenshots into `output/task11-primary-host-recovery-delivery/` for:

1. pending delivery before reveal, with no close affordance;
2. revealed package and copy action;
3. simulated ACK outage retaining the modal and secret;
4. acknowledged state after retry, with high-risk host actions unblocked;
5. the previously verified System Settings OSS updater card and successful OSS check.

Record the viewport, Electron version, fixture epoch/delivery IDs, and zero renderer/main-process errors. Confirm keyboard Escape, mask click, window reload, and process relaunch cannot bypass or lose the pending delivery.

- [ ] **Step 8: Restore Node ABI and verify both SQLite copies**

After the Electron run, execute:

```powershell
npm run rebuild:node
node -e "const D=require('better-sqlite3');const db=new D(':memory:');console.log(db.prepare('select 1 as ok').get().ok);db.close()"
node -e "const D=require('./backend/node_modules/better-sqlite3');const db=new D(':memory:');console.log(db.prepare('select 1 as ok').get().ok);db.close()"
```

Expected: both commands print `1` with no ABI error.

- [ ] **Step 9: Update auditable Task 11 evidence without claiming publication**

In `docs/verification-2026-07-17-desktop-human-identity.md`:

- change schema evidence from 3107 to 3108;
- add the encrypted-delivery protocol, target-only visibility, five-minute ACK proof, 24-hour/7-day alert, no-timeout deletion, both crash windows, remote-first cleanup, and isolated Electron screenshots;
- list exact verification commands, exit codes, versions, and screenshot paths;
- change `verification_status` to `completed` only if every Task 11 item is evidenced;
- keep `release_status: not-published` because the unified multi-end release matrix has not run.

In `docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md`, mark only the Task 10/11 checkboxes proven by current evidence. Do not mark real host migration, cloud deployment, miniapp upload, OSS publication, or unified release complete.

- [ ] **Step 10: Commit Task 8 evidence and gates, then return to the deferred student plan**

Run the release gate once more:

`npm run check:desktop-identity-release`

Expected: PASS with `release_status: not-published` still visible in the status evidence.

```powershell
git add -- scripts/check_deploy_readiness.js scripts/check_deploy_readiness.test.js docs/verification-2026-07-17-desktop-human-identity.md docs/superpowers/plans/2026-07-17-desktop-human-identity-multi-device.md package.json
git commit -m "自动发布 2026-07-19"
```

Do not push, package, publish OSS, deploy Aliyun, upload the miniapp, or install on the real primary host at this stage. After Task 11 is proven, resume `docs/superpowers/plans/2026-07-16-unrecognized-student-membership.md`, then build and verify the full desktop/primary-host/Aliyun/miniapp/OSS release matrix before any publication claim.

---

## Execution decision

The user already approved continuing in this task, so use inline execution with `superpowers:executing-plans`. Current collaboration instructions prohibit proactive subagent dispatch; execute each RED/GREEN task in this workspace, preserve unrelated dirty files, checkpoint after each task, and keep all publishing actions disabled until the unified matrix is ready.
