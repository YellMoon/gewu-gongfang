const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const packageJson = require('../package.json');
const {
  generateRecoveryDeliveryKeyPair,
} = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol');
const { createPrimaryHostCredentialStore } = require('./primaryHostCredentialStore');

function mockSafeStorage(control = {}) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => {
      if (control.failEncryption) throw new Error('simulated DPAPI failure');
      return Buffer.from(`dpapi:${Buffer.from(String(value), 'utf8').toString('base64')}`, 'utf8');
    },
    decryptString: value => {
      const raw = Buffer.from(value).toString('utf8');
      if (!raw.startsWith('dpapi:')) throw new Error('integrity failure');
      return Buffer.from(raw.slice(6), 'base64').toString('utf8');
    },
  };
}

assert.ok(
  packageJson.build.files.includes('public/primaryHostCredentialStore.js'),
  'packaged Electron app must include the primary-host credential store'
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-primary-host-credential-'));
const filePath = path.join(dir, 'primary-host-credential-v1.bin');
const encryptionControl = { failEncryption: false };
const store = createPrimaryHostCredentialStore({ filePath, safeStorage: mockSafeStorage(encryptionControl) });

assert.deepStrictEqual(store.status(), { state: 'empty', active: false });
const staged = store.stage({
  stageId: 'transfer:challenge-2',
  operation: 'transfer',
  deviceId: 'desktop-host-a',
  targetGeneration: 2,
  hostCredential: 'locally-generated-host-secret-generation-2',
});
assert.deepStrictEqual(staged, {
  state: 'staged',
  active: false,
  stageId: 'transfer:challenge-2',
  operation: 'transfer',
  deviceId: 'desktop-host-a',
  generation: 2,
  credentialCommitment: staged.credentialCommitment,
});
assert.match(staged.credentialCommitment, /^[a-f0-9]{64}$/);
assert.strictEqual(store.read().credential, 'locally-generated-host-secret-generation-2');
assert.ok(!Object.prototype.hasOwnProperty.call(store.status(), 'credential'));
assert.ok(!fs.readFileSync(filePath).toString('utf8').includes('locally-generated-host-secret-generation-2'));

encryptionControl.failEncryption = true;
assert.throws(() => store.commit({
  stageId: staged.stageId,
  epoch: {
    id: 'epoch-2', generation: 2, deviceId: 'desktop-host-a', userId: 'canonical-owner',
    activatedAt: '2026-07-18T02:00:00.000Z',
  },
}), /simulated DPAPI failure/);
encryptionControl.failEncryption = false;
assert.strictEqual(store.read().state, 'staged', 'failed post-activation commit must preserve the recoverable staged credential');
assert.strictEqual(store.read().credential, 'locally-generated-host-secret-generation-2');
store.clear();

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
  algorithm: deliveryKey.algorithm,
  publicKeyPem: deliveryKey.publicKeyPem,
  publicKeyFingerprint: deliveryKey.publicKeyFingerprint,
});
assert.strictEqual(JSON.stringify(stagedWithKey).includes(deliveryKey.privateKeyPem), false);
assert.strictEqual(fs.readFileSync(filePath, 'utf8').includes(deliveryKey.privateKeyPem), false);

const afterStageRestart = createPrimaryHostCredentialStore({
  filePath,
  safeStorage: mockSafeStorage(encryptionControl),
});
assert.strictEqual(
  afterStageRestart.read().recoveryDeliveryKey.privateKeyPem,
  deliveryKey.privateKeyPem
);
const pendingRecoveryDelivery = {
  deliveryId: 'delivery-2',
  epochId: 'epoch-2',
  factorId: 'factor-2',
  generation: 2,
  acknowledgementNonce: 'a'.repeat(64),
  rowVersion: 1,
  recipientPublicKeyFingerprint: deliveryKey.publicKeyFingerprint,
  recoveryPackage: {
    factorId: 'factor-2',
    recoveryCode: 'offline-only-recovery-code-with-more-than-32-characters',
    epochId: 'epoch-2',
    generation: 2,
    deviceId: 'desktop-host-a',
    createdAt: '2026-07-19T01:00:00.000Z',
  },
};
afterStageRestart.commit({
  stageId: stagedWithKey.stageId,
  epoch: {
    id: 'epoch-2', generation: 2, deviceId: 'desktop-host-a', userId: 'canonical-owner',
    activatedAt: '2026-07-19T01:00:00.000Z',
  },
  pendingRecoveryDelivery,
});
assert.strictEqual(JSON.stringify(afterStageRestart.status()).includes('offline-only-recovery-code'), false);
assert.strictEqual(JSON.stringify(afterStageRestart.status()).includes('acknowledgementNonce'), false);
assert.deepStrictEqual(afterStageRestart.status().recoveryDelivery, {
  pending: true,
  deliveryId: 'delivery-2',
  epochId: 'epoch-2',
  rowVersion: 1,
});

const afterAdoptionRestart = createPrimaryHostCredentialStore({
  filePath,
  safeStorage: mockSafeStorage(encryptionControl),
});
assert.strictEqual(
  afterAdoptionRestart.revealRecoveryPackage({ deliveryId: 'delivery-2' })
    .recoveryPackage.recoveryCode,
  'offline-only-recovery-code-with-more-than-32-characters'
);
assert.throws(
  () => afterAdoptionRestart.clearRecoveryDelivery({ deliveryId: 'delivery-other' }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'
);
afterAdoptionRestart.clearRecoveryDelivery({ deliveryId: 'delivery-2' });
assert.deepStrictEqual(afterAdoptionRestart.status().recoveryDelivery, { pending: false });
assert.strictEqual(afterAdoptionRestart.read().credential, 'locally-generated-host-secret-generation-2');
assert.strictEqual(Object.hasOwn(afterAdoptionRestart.read(), 'recoveryDeliveryKey'), false);
assert.strictEqual(Object.hasOwn(afterAdoptionRestart.read(), 'pendingRecoveryDelivery'), false);
assert.strictEqual(afterAdoptionRestart.read().recoveryDeliveryAcknowledgement.deliveryId, 'delivery-2');
assert.throws(
  () => afterAdoptionRestart.revealRecoveryPackage({ deliveryId: 'delivery-2' }),
  error => error?.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_PENDING'
);
store.clear();

const metadata = store.write({
  epoch: {
    id: 'epoch-1',
    generation: 1,
    deviceId: 'desktop-host-a',
    userId: 'canonical-owner',
    activatedAt: '2026-07-18T01:00:00.000Z',
  },
  hostCredential: 'host-secret-generation-1',
});
assert.deepStrictEqual(metadata, {
  state: 'active',
  active: true,
  epochId: 'epoch-1',
  generation: 1,
  deviceId: 'desktop-host-a',
  userId: 'canonical-owner',
  activatedAt: '2026-07-18T01:00:00.000Z',
  recoveryDelivery: { pending: false },
});
assert.deepStrictEqual(store.status(), metadata);
const raw = fs.readFileSync(filePath);
assert.ok(!raw.toString('utf8').includes('host-secret-generation-1'));
assert.deepStrictEqual(store.read(), {
  version: 1,
  epochId: 'epoch-1',
  generation: 1,
  deviceId: 'desktop-host-a',
  userId: 'canonical-owner',
  activatedAt: '2026-07-18T01:00:00.000Z',
  credential: 'host-secret-generation-1',
});
assert.ok(!Object.prototype.hasOwnProperty.call(store.status(), 'credential'));

store.write({
  epoch: {
    id: 'epoch-2', generation: 2, deviceId: 'desktop-host-a', userId: 'canonical-owner',
    activatedAt: '2026-07-18T02:00:00.000Z',
  },
  hostCredential: 'host-secret-generation-2',
});
assert.strictEqual(store.read().generation, 2);
assert.strictEqual(store.read().credential, 'host-secret-generation-2');
assert.ok(!fs.readFileSync(filePath).toString('utf8').includes('host-secret-generation-1'));

assert.throws(() => store.write({
  epoch: { id: 'bad', generation: 0, deviceId: 'x', userId: 'u', activatedAt: 'bad-date' },
  hostCredential: '',
}), /PRIMARY_HOST_CREDENTIAL_INVALID/);

store.clear();
assert.deepStrictEqual(store.status(), { state: 'empty', active: false });
assert.strictEqual(store.read(), null);
assert.throws(
  () => createPrimaryHostCredentialStore({
    filePath,
    safeStorage: { isEncryptionAvailable: () => false },
  }).write({
    epoch: { id: 'e', generation: 1, deviceId: 'd', userId: 'u', activatedAt: '2026-07-18T00:00:00.000Z' },
    hostCredential: 'credential',
  }),
  /PRIMARY_HOST_ENCRYPTION_UNAVAILABLE/
);

fs.rmSync(dir, { recursive: true, force: true });
console.log('primary host credential store checks passed');
