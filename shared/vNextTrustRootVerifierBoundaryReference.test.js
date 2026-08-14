'use strict';

const assert = require('assert');
const {
  createVNextTrustRootVerifierBoundaryReference,
  isVNextTrustRootVerifierBoundaryReferenceForDatabase,
} = require('./vNextTrustRootVerifierBoundaryReference');

const HASH = 'a'.repeat(64);
const NOW = '2026-08-14T00:00:00.000Z';
function expectCode(action, code) {
  return assert.rejects(action, error => error && error.code === code && error.message === code);
}
function bootstrapResult(overrides = {}) {
  return {
    kind: 'deployment_bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1',
    installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: HASH,
    policyManifestSha256: HASH, expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH,
    ...overrides,
  };
}
function recoveryResult(overrides = {}) {
  return {
    kind: 'owner_recovery_event', recoveryEventId: 'recovery-event-1', authorityId: 'authority-1', replacementAccountId: 'replacement-account-1',
    replacementDeviceId: 'replacement-device-1', replacementInstallationId: 'replacement-installation-1', replacementInstallationPublicKey: 'public-key-2', replacementInstallationKeyFingerprint: HASH,
    backupId: 'backup-1', backupManifestSha256: HASH, reasonCode: 'owner_loss', expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH,
    ...overrides,
  };
}

(async () => {
  const dbA = Object.freeze({ name: 'db-a' });
  const dbB = Object.freeze({ name: 'db-b' });
  for (const config of [undefined, null, [], {}, { databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW, extra: true }]) {
    assert.throws(() => createVNextTrustRootVerifierBoundaryReference(config), error => error && error.code === 'VNEXT_TRUST_ROOT_VERIFIER_INVALID');
  }
  let configReads = 0;
  const accessorConfig = { databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW };
  Object.defineProperty(accessorConfig, 'now', { enumerable: true, get() { configReads += 1; return () => NOW; } });
  const hiddenConfig = { databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW };
  Object.defineProperty(hiddenConfig, 'now', { enumerable: false, value: () => NOW });
  for (const config of [accessorConfig, hiddenConfig, { databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW, [Symbol('x')]: true }, new Proxy({ databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW }, {})]) {
    assert.throws(() => createVNextTrustRootVerifierBoundaryReference(config), error => error && error.code === 'VNEXT_TRUST_ROOT_VERIFIER_INVALID');
  }
  assert.strictEqual(configReads, 0);
  const mutable = bootstrapResult();
  const boundary = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: dbA, verifyBootstrapPresentation: () => mutable, verifyRecoveryPresentation: () => Promise.resolve(recoveryResult()), now: () => NOW });
  assert.ok(Object.isFrozen(boundary));
  assert.ok(isVNextTrustRootVerifierBoundaryReferenceForDatabase(boundary, dbA));
  assert.ok(!isVNextTrustRootVerifierBoundaryReferenceForDatabase(boundary, dbB));
  assert.ok(!isVNextTrustRootVerifierBoundaryReferenceForDatabase({}, undefined), 'unbranded values must never match undefined');
  const bootstrapAssertion = await boundary.verifyBootstrap(Object.freeze({ untrusted: true }));
  mutable.accountId = 'changed-after-return';
  assert.ok(Object.isFrozen(bootstrapAssertion));
  assert.deepStrictEqual(Reflect.ownKeys(bootstrapAssertion), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(bootstrapAssertion)), {});
  const bootstrapSnapshot = boundary.unwrap(bootstrapAssertion, 'deployment_bootstrap');
  assert.ok(Object.isFrozen(bootstrapSnapshot));
  assert.deepStrictEqual(bootstrapSnapshot.accountId, 'account-1');
  assert.throws(() => { bootstrapSnapshot.accountId = 'forged'; }, TypeError);
  assert.deepStrictEqual(boundary.unwrap(bootstrapAssertion, 'deployment_bootstrap'), boundary.unwrap(bootstrapAssertion, 'deployment_bootstrap'));
  const recoveryAssertion = await boundary.verifyRecovery(null);
  assert.strictEqual(boundary.unwrap(recoveryAssertion, 'owner_recovery_event').backupId, 'backup-1');
  const snapshotAtVerifierReturn = bootstrapResult();
  const toctouBoundary = createVNextTrustRootVerifierBoundaryReference({
    databaseBinding: dbA,
    verifyBootstrapPresentation: () => snapshotAtVerifierReturn,
    verifyRecoveryPresentation: () => recoveryResult(),
    now: () => { snapshotAtVerifierReturn.accountId = 'changed-by-clock'; return NOW; },
  });
  const toctouAssertion = await toctouBoundary.verifyBootstrap(null);
  assert.strictEqual(toctouBoundary.unwrap(toctouAssertion, 'deployment_bootstrap').accountId, 'account-1', 'clock must not alter the verifier-return snapshot');
  for (const field of ['verifyBootstrapPresentation', 'verifyRecoveryPresentation', 'now']) {
    const config = { databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW };
    config[field] = new Proxy(config[field], {});
    assert.throws(() => createVNextTrustRootVerifierBoundaryReference(config), error => error && error.code === 'VNEXT_TRUST_ROOT_VERIFIER_INVALID');
  }
  for (const fake of [{}, { ...bootstrapAssertion }, JSON.parse(JSON.stringify(bootstrapAssertion)), Object.freeze(Object.create(null))]) {
    assert.throws(() => boundary.unwrap(fake, 'deployment_bootstrap'), error => error && error.code === 'VNEXT_TRUST_ROOT_ASSERTION_INVALID');
  }
  assert.throws(() => boundary.unwrap(bootstrapAssertion, 'owner_recovery_event'), error => error && error.code === 'VNEXT_TRUST_ROOT_ASSERTION_INVALID');
  const otherBoundary = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: dbB, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW });
  assert.throws(() => otherBoundary.unwrap(bootstrapAssertion, 'deployment_bootstrap'), error => error && error.code === 'VNEXT_TRUST_ROOT_ASSERTION_INVALID');

  for (const result of [
    bootstrapResult({ approvalVersion: 2 }), bootstrapResult({ approvalVersion: '1' }), bootstrapResult({ approvalVersion: 1.5 }),
    bootstrapResult({ expiresAt: NOW }), bootstrapResult({ expiresAt: '2026-08-14T00:06:00.000Z' }), bootstrapResult({ expiresAt: 'invalid-time' }),
    bootstrapResult({ policyManifestSha256: 'A'.repeat(64) }), bootstrapResult({ assertionEvidenceSha256: 'a'.repeat(63) }), bootstrapResult({ accountId: ' ' }),
    { ...bootstrapResult(), extra: 'forged' }, Object.defineProperty({}, 'kind', { enumerable: true, get() { return 'deployment_bootstrap'; } }),
    new Proxy(bootstrapResult(), {}), { ...recoveryResult(), kind: 'deployment_bootstrap' },
  ]) {
    const rejecting = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: dbA, verifyBootstrapPresentation: () => result, verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW });
    await expectCode(() => rejecting.verifyBootstrap({ hidden: 'presentation' }), 'VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
  }
  for (const kind of ['bootstrap', 'recovery']) {
    const make = kind === 'bootstrap' ? bootstrapResult : recoveryResult;
    const field = kind === 'bootstrap' ? 'accountId' : 'replacementAccountId';
    const verifyKey = kind === 'bootstrap' ? 'verifyBootstrapPresentation' : 'verifyRecoveryPresentation';
    let reads = 0;
    const accessor = make();
    Object.defineProperty(accessor, field, { enumerable: true, get() { reads += 1; return 'must-not-read'; } });
    const hidden = make(); Object.defineProperty(hidden, field, { enumerable: false, value: hidden[field] });
    const symbol = { ...make(), [Symbol('hidden')]: true };
    const customPrototype = make(); Object.setPrototypeOf(customPrototype, null);
    let traps = 0; const hostileProxy = new Proxy(make(), { ownKeys() { traps += 1; throw new Error('private trap'); } });
    for (const result of [accessor, hidden, symbol, customPrototype, hostileProxy]) {
      const config = { databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW };
      config[verifyKey] = () => result;
      const rejecting = createVNextTrustRootVerifierBoundaryReference(config);
      await expectCode(() => kind === 'bootstrap' ? rejecting.verifyBootstrap(null) : rejecting.verifyRecovery(null), 'VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
    }
    assert.strictEqual(reads, 0); assert.strictEqual(traps, 0);
  }
  for (const clock of [() => { throw new Error('private clock'); }, () => 'invalid-time', () => '2026-08-14T00:00:00+00:00', () => ({})]) {
    const rejecting = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: clock });
    await expectCode(() => rejecting.verifyBootstrap(null), 'VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
  }
  let bindingReads = 0;
  const unreadBinding = Object.defineProperty({}, 'private', { get() { bindingReads += 1; throw new Error('must not read'); } });
  const unreadBoundary = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: unreadBinding, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW });
  await unreadBoundary.verifyBootstrap(null); assert.strictEqual(bindingReads, 0);
  for (const result of [bootstrapResult({ installationPublicKey: ' ' }), bootstrapResult({ installationPublicKey: 'a'.repeat(16 * 1024 + 1) }), recoveryResult({ replacementInstallationPublicKey: ' ' }), recoveryResult({ replacementInstallationPublicKey: 'a'.repeat(16 * 1024 + 1) })]) {
    const rejecting = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: dbA, verifyBootstrapPresentation: () => result, verifyRecoveryPresentation: () => result, now: () => NOW });
    await expectCode(() => result.kind === 'deployment_bootstrap' ? rejecting.verifyBootstrap(null) : rejecting.verifyRecovery(null), 'VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
  }
  for (const result of [recoveryResult({ replacementAccountId: 1 }), { ...recoveryResult(), extra: 'forged' }, bootstrapResult()]) {
    const rejecting = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: dbA, verifyBootstrapPresentation: () => bootstrapResult(), verifyRecoveryPresentation: () => result, now: () => NOW });
    await expectCode(() => rejecting.verifyRecovery({ hidden: 'presentation' }), 'VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
  }
  for (const verifier of [() => { throw new Error('private verifier detail'); }, () => Promise.reject(new Error('private verifier detail')), () => ({ then() {} })]) {
    const rejecting = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: dbA, verifyBootstrapPresentation: verifier, verifyRecoveryPresentation: () => recoveryResult(), now: () => NOW });
    await expectCode(() => rejecting.verifyBootstrap({}), 'VNEXT_TRUST_ROOT_PRESENTATION_REJECTED');
  }
  console.log('vNext trust-root verifier boundary checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
