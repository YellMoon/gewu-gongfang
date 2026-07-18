const assert = require('assert');
const crypto = require('crypto');
const {
  PHYSICAL_CONFIRMATION,
  createPrimaryHostLocalReceipt,
  primaryHostOperationManifestHash,
  primaryHostReceiptSigningPayload,
  verifyPrimaryHostLocalReceiptSignature,
} = require('./primaryHostReceiptProtocol');

const keyPair = crypto.generateKeyPairSync('ed25519');
const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const receipt = createPrimaryHostLocalReceipt({
  operation: 'transfer',
  challengeId: 'challenge-transfer-1',
  identity: {
    userId: 'canonical-owner',
    deviceId: 'desktop-target',
    authorizationId: 'authorization-target',
    credentialVersion: 4,
  },
  evidence: {
    runtimeNodeRole: 'desktop-client',
    dbInstanceDigest: 'a'.repeat(64),
    schemaVersion: 3107,
    storeId: 'store-1',
    dbAuthorityId: 'authority-1',
    quickCheck: 'ok',
  },
  physicalConfirmation: PHYSICAL_CONFIRMATION,
  operationManifest: {
    backup: { authoritative: true, sha256: 'b'.repeat(64), sourceGeneration: 1 },
    sync: { dryRun: 'ok', sourceGeneration: 1, targetGeneration: 2 },
  },
  now: () => new Date('2026-07-18T06:00:00.000Z'),
  randomBytes: size => Buffer.alloc(size, 7),
});
assert.strictEqual(receipt.version, 2);
assert.strictEqual(receipt.authorizationId, 'authorization-target');
assert.strictEqual(receipt.credentialVersion, 4);
assert.strictEqual(receipt.operationManifestHash, primaryHostOperationManifestHash({
  backup: { authoritative: true, sha256: 'b'.repeat(64), sourceGeneration: 1 },
  sync: { dryRun: 'ok', sourceGeneration: 1, targetGeneration: 2 },
}));
assert.strictEqual(receipt.issuedAt, '2026-07-18T06:00:00.000Z');
assert.strictEqual(receipt.expiresAt, '2026-07-18T06:02:00.000Z');
const payload = primaryHostReceiptSigningPayload(receipt);
assert.ok(payload.startsWith('gewu-primary-host-local-receipt-v2\n'));
const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
assert.strictEqual(verifyPrimaryHostLocalReceiptSignature({ receipt, signature, publicKey }), true);
assert.throws(() => verifyPrimaryHostLocalReceiptSignature({
  receipt: { ...receipt, storeId: 'tampered-store' }, signature, publicKey,
}), /PRIMARY_HOST_LOCAL_RECEIPT_SIGNATURE_INVALID/);
assert.throws(() => createPrimaryHostLocalReceipt({
  ...receipt,
  identity: receipt,
  evidence: receipt,
  physicalConfirmation: 'clicked-remotely',
}), /PRIMARY_HOST_PHYSICAL_CONFIRMATION_REQUIRED/);

console.log('primary host receipt protocol checks passed');
