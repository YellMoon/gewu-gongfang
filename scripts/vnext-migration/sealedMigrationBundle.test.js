'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSealedMigrationBundle,
  decryptBundleFile,
  fingerprintPublicKey,
  verifySealedMigrationBundle,
} = require('./sealedMigrationBundle');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-sealed-bundle-'));
try {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const otherKeys = crypto.generateKeyPairSync('ed25519');
  const encryptionKey = crypto.randomBytes(32);
  const publicKeyFingerprint = fingerprintPublicKey(publicKey);
  const bundlePath = path.join(root, 'bundle');

  const result = createSealedMigrationBundle({
    bundlePath,
    bundleId: 'sealed-test-001',
    environment: 'shadow',
    sourceSnapshotHash: 'a'.repeat(64),
    sourceInventoryHash: 'b'.repeat(64),
    catalogHash: 'c'.repeat(64),
    signingPrivateKey: privateKey,
    encryptionKey,
    payloads: [
      { relativePath: 'business/tenants.ndjson', records: [{ id: 'tenant-1', name: '\u683c\u7269' }], classification: 'business' },
      { relativePath: 'archive/sessions.ndjson', records: [{ recordHash: 'd'.repeat(64) }], classification: 'archive' },
      { relativePath: 'reports/migration-ledger.ndjson', records: [{ sourceId: 'tenant-1', status: 'discovered' }], classification: 'ledger' },
    ],
  });

  assert.ok(fs.statSync(bundlePath).isDirectory());
  assert.ok(!fs.existsSync(`${bundlePath}.partial`));
  assert.match(result.bundleHash, /^[a-f0-9]{64}$/);
  assert.strictEqual(result.publicKeyFingerprint, publicKeyFingerprint);
  assert.strictEqual(result.encryptedFileCount, 3);
  assert.strictEqual(result.bundleId, 'sealed-test-001');

  const serialized = fs.readdirSync(bundlePath, { recursive: true })
    .filter(entry => fs.statSync(path.join(bundlePath, entry)).isFile())
    .map(entry => fs.readFileSync(path.join(bundlePath, entry)))
    .reduce((all, bytes) => Buffer.concat([all, bytes]), Buffer.alloc(0));
  assert.ok(!serialized.includes(Buffer.from('tenant-1')));
  assert.ok(!serialized.includes(Buffer.from('\u683c\u7269')));

  const verified = verifySealedMigrationBundle({
    bundlePath,
    signingPublicKey: publicKey,
    encryptionKey,
    allowedPublicKeyFingerprints: [publicKeyFingerprint],
    expectedEnvironment: 'shadow',
  });
  assert.strictEqual(verified.bundleHash, result.bundleHash);
  assert.strictEqual(verified.bundleId, result.bundleId);
  assert.strictEqual(verified.payloads.length, 3);

  const tenantBytes = decryptBundleFile({
    bundlePath,
    relativePath: 'business/tenants.ndjson.enc',
    encryptionKey,
    signingPublicKey: publicKey,
    allowedPublicKeyFingerprints: [publicKeyFingerprint],
    expectedEnvironment: 'shadow',
  });
  assert.deepStrictEqual(JSON.parse(tenantBytes.toString('utf8').trim()), { id: 'tenant-1', name: '\u683c\u7269' });

  assert.throws(
    () => verifySealedMigrationBundle({
      bundlePath, signingPublicKey: otherKeys.publicKey, encryptionKey,
      allowedPublicKeyFingerprints: [publicKeyFingerprint], expectedEnvironment: 'shadow',
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_SIGNING_KEY_NOT_ALLOWED',
  );

  const nonceReusePath = path.join(root, 'nonce-reuse');
  const repeatedNonce = Buffer.alloc(12, 7);
  assert.throws(
    () => createSealedMigrationBundle({
      bundlePath: nonceReusePath,
      bundleId: 'sealed-nonce-reuse',
      environment: 'shadow',
      sourceSnapshotHash: 'a'.repeat(64),
      sourceInventoryHash: 'b'.repeat(64),
      catalogHash: 'c'.repeat(64),
      signingPrivateKey: privateKey,
      encryptionKey,
      payloads: [
        { relativePath: 'business/one.ndjson', records: [{ id: 1 }], classification: 'business' },
        { relativePath: 'business/two.ndjson', records: [{ id: 2 }], classification: 'business' },
      ],
      testHooks: { overrideNonce: () => repeatedNonce },
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_NONCE_REUSE',
  );
  assert.throws(
    () => verifySealedMigrationBundle({
      bundlePath, signingPublicKey: publicKey, encryptionKey: crypto.randomBytes(32),
      allowedPublicKeyFingerprints: [publicKeyFingerprint], expectedEnvironment: 'shadow',
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_DECRYPT_FAILED',
  );
  assert.throws(
    () => verifySealedMigrationBundle({
      bundlePath, signingPublicKey: publicKey, encryptionKey,
      allowedPublicKeyFingerprints: [publicKeyFingerprint], expectedEnvironment: 'production',
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_ENVIRONMENT_MISMATCH',
  );

  const tampered = path.join(bundlePath, 'business', 'tenants.ndjson.enc');
  const bytes = fs.readFileSync(tampered);
  bytes[0] ^= 1;
  fs.writeFileSync(tampered, bytes);
  assert.throws(
    () => verifySealedMigrationBundle({
      bundlePath, signingPublicKey: publicKey, encryptionKey,
      allowedPublicKeyFingerprints: [publicKeyFingerprint], expectedEnvironment: 'shadow',
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_CIPHERTEXT_HASH_MISMATCH',
  );

  assert.throws(
    () => createSealedMigrationBundle({
      bundlePath, bundleId: 'sealed-test-002', environment: 'shadow',
      sourceSnapshotHash: 'a'.repeat(64), sourceInventoryHash: 'b'.repeat(64), catalogHash: 'c'.repeat(64),
      signingPrivateKey: privateKey, encryptionKey, payloads: [],
    }),
    error => error && error.code === 'MIGRATION_BUNDLE_ALREADY_EXISTS',
  );

  console.log('sealed and signed migration bundle checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
