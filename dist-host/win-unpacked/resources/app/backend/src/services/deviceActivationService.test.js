const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { activationReceiptSigningPayload, createDeviceActivationService } = require('./deviceActivationService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE desktop_device_authorizations (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
    user_id TEXT NOT NULL, public_key TEXT NOT NULL, row_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE TABLE desktop_device_activations (
    id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL UNIQUE, authorization_id TEXT NOT NULL,
    package_hash TEXT NOT NULL, package_json TEXT NOT NULL, status TEXT NOT NULL,
    expires_at TEXT NOT NULL, finalized_at TEXT, receipt_hash TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE device_grants (
    grant_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, device_id TEXT NOT NULL,
    user_id TEXT NOT NULL, public_key TEXT NOT NULL, host_generation INTEGER NOT NULL,
    status TEXT NOT NULL, grant_version INTEGER NOT NULL, approved_by TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE device_leases (
    lease_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, authority_id TEXT NOT NULL,
    device_id TEXT NOT NULL, user_id TEXT NOT NULL, active_role TEXT NOT NULL,
    grant_version INTEGER NOT NULL, status TEXT NOT NULL, issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_type TEXT, subject_id TEXT, status TEXT NOT NULL,
    grant_version INTEGER NOT NULL, granted_by TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE UNIQUE INDEX idx_authority_role_bindings_active
    ON authority_role_bindings(authority_id,user_id,role) WHERE status='active';
`);
const deviceKeyPair = crypto.generateKeyPairSync('ed25519');
const devicePublicKey = deviceKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
db.prepare(`INSERT INTO desktop_device_authorizations(id,device_id,status,user_id,public_key,updated_at)
  VALUES('authorization-1','device-1','pending','user-1',?,'2026-07-28T00:00:00.000Z')`).run(devicePublicKey);

let sequence = 0;
const service = createDeviceActivationService({
  db,
  now: () => '2026-07-28T00:00:00.000Z',
  createId: () => `activation-${++sequence}`,
});

const exchanged = service.exchange({
  challengeId: 'challenge-1', authorizationId: 'authorization-1',
  activationPackage: {
    userId: 'user-1',
    deviceId: 'device-1',
    authorityId: 'authority-1',
    hostGeneration: 2,
    approvedBy: 'host-admin-1',
    grant: { id: 'grant-1', version: 3 },
    lease: {
      id: 'lease-1',
      activeRole: 'teacher',
      issuedAt: '2026-07-28T00:00:00.000Z',
      expiresAt: '2026-08-11T00:00:00.000Z',
    },
  },
});
assert.strictEqual(exchanged.activation.status, 'activation_pending');
assert.strictEqual(
  db.prepare(`SELECT status FROM desktop_device_authorizations WHERE id='authorization-1'`).get().status,
  'pending',
  'exchange must never activate a server device before the desktop vault is sealed'
);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM device_grants').get().count, 0);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM device_leases').get().count, 0);

const activationRow = db.prepare('SELECT package_hash FROM desktop_device_activations WHERE id=?').get(exchanged.activation.id);
const activationSignature = crypto.sign(
  null,
  Buffer.from(activationReceiptSigningPayload({ activationId: exchanged.activation.id, packageHash: activationRow.package_hash }), 'utf8'),
  deviceKeyPair.privateKey
).toString('base64');
const active = service.finalize({ activationId: exchanged.activation.id, signature: activationSignature });
assert.strictEqual(active.activation.status, 'active');
assert.strictEqual(
  db.prepare(`SELECT status FROM desktop_device_authorizations WHERE id='authorization-1'`).get().status,
  'active',
  'finalize activates only after a receipt is submitted'
);
assert.deepStrictEqual(
  db.prepare(`SELECT grant_id, authority_id, device_id, user_id, status, grant_version
    FROM device_grants WHERE grant_id='grant-1'`).get(),
  {
    grant_id: 'grant-1',
    authority_id: 'authority-1',
    device_id: 'device-1',
    user_id: 'user-1',
    status: 'active',
    grant_version: 3,
  },
);
assert.deepStrictEqual(
  db.prepare(`SELECT lease_id, grant_id, active_role, status, grant_version
    FROM device_leases WHERE lease_id='lease-1'`).get(),
  {
    lease_id: 'lease-1',
    grant_id: 'grant-1',
    active_role: 'teacher',
    status: 'active',
    grant_version: 3,
  },
);
assert.deepStrictEqual(
  db.prepare(`SELECT authority_id,user_id,role,status,grant_version
    FROM authority_role_bindings WHERE authority_id='authority-1'`).get(),
  { authority_id: 'authority-1', user_id: 'user-1', role: 'teacher', status: 'active', grant_version: 3 },
  'activation must atomically persist the role material used by authority command authorization'
);
assert.strictEqual(
  service.resume({ activationId: exchanged.activation.id, signature: activationSignature }).replayed,
  true,
  'a repeated finalize receipt is safe after a process restart'
);
assert.throws(
  () => service.resume({ activationId: exchanged.activation.id, signature: Buffer.alloc(64).toString('base64') }),
  error => error?.code === 'DEVICE_ACTIVATION_SIGNATURE_INVALID'
);

console.log('deviceActivationService tests passed');
