'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { bootstrapVNextControlPlaneReference } = require('./vNextControlPlaneReferenceKernel');
const { createVNextTrustRootVerifierBoundaryReference } = require('./vNextTrustRootVerifierBoundaryReference');
const { createVNextFirstAuthorityBootstrapReference } = require('./vNextFirstAuthorityBootstrapReference');
const policy = require('./vNextAuthorizationPolicyReference');
const HASH = 'a'.repeat(64);
const NOW = '2026-08-14T00:00:00.000Z';
const WRITTEN_TABLES = ['vNext_authorities','vNext_accounts','vNext_trusted_devices','vNext_device_installations','vNext_account_device_links','vNext_role_grants','vNext_authorization_command_receipts','vNext_authorization_policy_publications','vNext_bootstrap_consumptions','vNext_trust_root_evidence','vNext_authorization_audit_events','vNext_authorization_outbox_events'];
const EMPTY_TABLES = ['vNext_capability_catalog','vNext_capability_overrides','vNext_data_scope_grants','vNext_profile_bindings','vNext_sessions','vNext_recent_reauthentication_events','vNext_verified_contacts'];
const countRows = (db, tables) => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));

async function fixture({ proof = {}, clock = () => NOW, idFactory = prefix => `${prefix}-fixture` } = {}) {
  const db = new Database(':memory:'); bootstrapVNextControlPlaneReference(db);
  const policyManifest = { contractVersion: 1, capabilities: [{ capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] }], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
  const policyHash = policy.policyManifestSha256(policyManifest);
  const verified = { kind: 'deployment_bootstrap', bootstrapIntentId: 'bootstrap-intent-fixture', authorityId: 'authority-fixture', accountId: 'account-fixture', deviceId: 'device-fixture', installationId: 'installation-fixture', installationPublicKey: 'public-key-fixture', installationKeyFingerprint: HASH, policyManifestSha256: policyHash, expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH, ...proof };
  const verifier = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: db, verifyBootstrapPresentation: () => verified, verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => NOW });
  const writer = createVNextFirstAuthorityBootstrapReference({ db, verifier, now: clock, idFactory });
  const assertion = await verifier.verifyBootstrap(null);
  const command = { type: 'authority.bootstrap', bootstrapIntentId: 'bootstrap-intent-fixture', authorityId: 'authority-fixture', accountId: 'account-fixture', deviceId: 'device-fixture', installationId: 'installation-fixture', installationPublicKey: 'public-key-fixture', installationKeyFingerprint: HASH, policyManifest, idempotencyKey: 'bootstrap-key-fixture', reasonCode: 'initial-owner' };
  return { assertion, command, db, policyHash, verifier, writer };
}

(async () => {
  const db = new Database(':memory:');
  try {
    bootstrapVNextControlPlaneReference(db);
    const policyManifest = { contractVersion: 1, capabilities: [{ capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] }], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
    const policyHash = policy.policyManifestSha256(policyManifest);
    const verifier = createVNextTrustRootVerifierBoundaryReference({
      databaseBinding: db,
      verifyBootstrapPresentation: () => ({ kind: 'deployment_bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: HASH, policyManifestSha256: policyHash, expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH }),
      verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => NOW,
    });
    let hookGetterReads = 0;
    const accessorHooks = {}; Object.defineProperty(accessorHooks, 'afterWrite', { enumerable: true, get() { hookGetterReads += 1; return () => {}; } });
    assert.throws(() => createVNextFirstAuthorityBootstrapReference({ db, verifier, now: () => NOW, testHooks: accessorHooks }), error => error.code === 'BOOTSTRAP_WRITER_INVALID', 'test hooks must be snapshotted before a write transaction begins');
    assert.strictEqual(hookGetterReads, 0, 'factory must not evaluate a hook getter');
    let configGetterReads = 0;
    const accessorConfig = { verifier }; Object.defineProperty(accessorConfig, 'db', { enumerable: true, get() { configGetterReads += 1; return db; } });
    assert.throws(() => createVNextFirstAuthorityBootstrapReference(accessorConfig), error => error.code === 'BOOTSTRAP_WRITER_INVALID', 'factory accepts only own-data configuration');
    assert.strictEqual(configGetterReads, 0, 'factory must not evaluate a configuration getter');
    const writer = createVNextFirstAuthorityBootstrapReference({ db, verifier, now: () => NOW, idFactory: prefix => `${prefix}-1` });
    const assertion = await verifier.verifyBootstrap(null);
    const command = { type: 'authority.bootstrap', bootstrapIntentId: 'bootstrap-intent-1', authorityId: 'authority-1', accountId: 'account-1', deviceId: 'device-1', installationId: 'installation-1', installationPublicKey: 'public-key-1', installationKeyFingerprint: HASH, policyManifest, idempotencyKey: 'bootstrap-key-1', reasonCode: 'initial-owner' };
    const hiddenCapabilityManifest = { ...policyManifest, capabilities: [...policyManifest.capabilities] };
    Object.defineProperty(hiddenCapabilityManifest.capabilities, '0', { value: hiddenCapabilityManifest.capabilities[0], enumerable: false, configurable: true });
    assert.throws(() => writer.execute(assertion, { ...command, idempotencyKey: 'bootstrap-key-hidden-capability', policyManifest: hiddenCapabilityManifest }), error => error.code === 'BOOTSTRAP_INPUT_INVALID', 'nested policy arrays accept only enumerable own data elements');
    const result = writer.execute(assertion, command);
    assert.deepStrictEqual(result, { authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', replayed: false, status: 'accepted' });
    for (const table of WRITTEN_TABLES) assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1, table);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM vNext_sessions").get().count, 0);
    assert.deepStrictEqual(writer.execute(assertion, command), { authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', replayed: true, status: 'accepted' });
    db.prepare("UPDATE vNext_role_grants SET granted_by_account_id=? WHERE authority_id=? AND account_id=? AND role='super_admin'").run('account-1', 'authority-1', 'account-1');
    assert.throws(() => writer.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID', 'a replay must preserve the null trust-root grantor invariant');
    db.prepare("UPDATE vNext_role_grants SET granted_by_account_id=NULL WHERE authority_id=? AND account_id=? AND role='super_admin'").run('authority-1', 'account-1');
    db.prepare("UPDATE vNext_role_grants SET status='revoked', revoked_at=?, updated_at=?, row_version=row_version+1 WHERE authority_id=? AND account_id=? AND role='super_admin'").run('2026-08-14T00:01:00.000Z', '2026-08-14T00:01:00.000Z', 'authority-1', 'account-1');
    assert.throws(() => writer.execute(assertion, command), error => error.code === 'IDEMPOTENCY_RECEIPT_INVALID', 'a replay must revalidate the sole durable super-admin grant');
  } finally { db.close(); }
  for (const failureStage of ['authority', 'account', 'device', 'installation', 'link', 'grant', 'receipt', 'marker', 'publication', 'evidence', 'audit', 'outbox']) {
    const rollbackDb = new Database(':memory:');
    try {
      bootstrapVNextControlPlaneReference(rollbackDb);
      const policyManifest = { contractVersion: 1, capabilities: [{ capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] }], roleDefaults: { super_admin: ['access.manage', 'device.revoke', 'user.review'], teacher: [], student: [] } };
      const policyHash = policy.policyManifestSha256(policyManifest);
      const verifier = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: rollbackDb, verifyBootstrapPresentation: () => ({ kind: 'deployment_bootstrap', bootstrapIntentId: `bootstrap-intent-${failureStage}`, authorityId: `authority-${failureStage}`, accountId: `account-${failureStage}`, deviceId: `device-${failureStage}`, installationId: `installation-${failureStage}`, installationPublicKey: `public-key-${failureStage}`, installationKeyFingerprint: HASH, policyManifestSha256: policyHash, expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH }), verifyRecoveryPresentation: () => { throw new Error('unused'); }, now: () => NOW });
      const writer = createVNextFirstAuthorityBootstrapReference({ db: rollbackDb, verifier, now: () => NOW, idFactory: prefix => `${prefix}-${failureStage}`, testHooks: { afterWrite: ({ stage }) => { if (stage === failureStage) throw new Error('injected'); } } });
      const assertion = await verifier.verifyBootstrap(null);
      const command = { type: 'authority.bootstrap', bootstrapIntentId: `bootstrap-intent-${failureStage}`, authorityId: `authority-${failureStage}`, accountId: `account-${failureStage}`, deviceId: `device-${failureStage}`, installationId: `installation-${failureStage}`, installationPublicKey: `public-key-${failureStage}`, installationKeyFingerprint: HASH, policyManifest, idempotencyKey: `bootstrap-key-${failureStage}`, reasonCode: 'initial-owner' };
      assert.throws(() => writer.execute(assertion, command), /injected/, failureStage);
      for (const table of WRITTEN_TABLES) assert.strictEqual(rollbackDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${failureStage}:${table}`);
    } finally { rollbackDb.close(); }
  }
  for (const [label, mutateProof, mutateCommand, expectedCode] of [
    ['intent', {}, command => ({ ...command, bootstrapIntentId: 'other-intent' }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
    ['authority', {}, command => ({ ...command, authorityId: 'other-authority' }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
    ['account', {}, command => ({ ...command, accountId: 'other-account' }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
    ['device', {}, command => ({ ...command, deviceId: 'other-device' }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
    ['installation', {}, command => ({ ...command, installationId: 'other-installation' }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
    ['public-key', {}, command => ({ ...command, installationPublicKey: 'other-key' }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
    ['fingerprint', {}, command => ({ ...command, installationKeyFingerprint: 'b'.repeat(64) }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
    ['policy-manifest', {}, command => ({ ...command, policyManifest: { ...command.policyManifest, roleDefaults: { ...command.policyManifest.roleDefaults, teacher: ['user.review'] } } }), 'BOOTSTRAP_ASSERTION_MISMATCH'],
  ]) {
    const current = await fixture({ proof: mutateProof });
    try {
      assert.throws(() => current.writer.execute(current.assertion, mutateCommand ? mutateCommand(current.command) : current.command), error => error.code === expectedCode, label);
      assert.deepStrictEqual(countRows(current.db, WRITTEN_TABLES), Object.fromEntries(WRITTEN_TABLES.map(table => [table, 0])), `${label} must not write`);
    } finally { current.db.close(); }
  }
  const expired = await fixture({ clock: () => '2026-08-14T00:04:00.000Z' });
  try { assert.throws(() => expired.writer.execute(expired.assertion, expired.command), error => error.code === 'BOOTSTRAP_ASSERTION_MISMATCH'); assert.deepStrictEqual(countRows(expired.db, WRITTEN_TABLES), Object.fromEntries(WRITTEN_TABLES.map(table => [table, 0]))); } finally { expired.db.close(); }
  const opaque = await fixture();
  try {
    assert.throws(() => opaque.writer.execute({}, opaque.command), error => error.code === 'BOOTSTRAP_ASSERTION_MISMATCH');
    const recoveryBoundary = createVNextTrustRootVerifierBoundaryReference({ databaseBinding: opaque.db, verifyBootstrapPresentation: () => { throw new Error('unused'); }, verifyRecoveryPresentation: () => ({ kind: 'owner_recovery_event', recoveryEventId: 'recovery-event-fixture', authorityId: 'authority-fixture', replacementAccountId: 'replacement-account', replacementDeviceId: 'replacement-device', replacementInstallationId: 'replacement-installation', replacementInstallationPublicKey: 'replacement-key', replacementInstallationKeyFingerprint: HASH, backupId: 'backup-fixture', backupManifestSha256: HASH, reasonCode: 'owner-recovery', expiresAt: '2026-08-14T00:04:00.000Z', approvalVersion: 1, assertionEvidenceSha256: HASH }), now: () => NOW });
    const recoveryAssertion = await recoveryBoundary.verifyRecovery(null);
    assert.throws(() => opaque.writer.execute(recoveryAssertion, opaque.command), error => error.code === 'BOOTSTRAP_ASSERTION_MISMATCH');
    assert.deepStrictEqual(countRows(opaque.db, WRITTEN_TABLES), Object.fromEntries(WRITTEN_TABLES.map(table => [table, 0])));
  } finally { opaque.db.close(); }
  const binding = await fixture(); const foreignDb = new Database(':memory:');
  try { bootstrapVNextControlPlaneReference(foreignDb); assert.throws(() => createVNextFirstAuthorityBootstrapReference({ db: foreignDb, verifier: binding.verifier, now: () => NOW }), error => error.code === 'BOOTSTRAP_WRITER_INVALID'); } finally { binding.db.close(); foreignDb.close(); }
  const clockFailure = await fixture({ clock: () => { throw new Error('private clock failure'); } });
  try { assert.throws(() => clockFailure.writer.execute(clockFailure.assertion, clockFailure.command), error => error.code === 'BOOTSTRAP_INPUT_INVALID' && !error.message.includes('private')); assert.deepStrictEqual(countRows(clockFailure.db, WRITTEN_TABLES), Object.fromEntries(WRITTEN_TABLES.map(table => [table, 0]))); } finally { clockFailure.db.close(); }
  const noncanonicalClock = await fixture({ clock: () => '2026-08-14T00:00:00+00:00' });
  try { assert.throws(() => noncanonicalClock.writer.execute(noncanonicalClock.assertion, noncanonicalClock.command), error => error.code === 'BOOTSTRAP_INPUT_INVALID'); assert.deepStrictEqual(countRows(noncanonicalClock.db, WRITTEN_TABLES), Object.fromEntries(WRITTEN_TABLES.map(table => [table, 0]))); } finally { noncanonicalClock.db.close(); }
  const preexistingAuthority = await fixture();
  try {
    preexistingAuthority.db.prepare("INSERT INTO vNext_authorities(authority_id,status,created_at,updated_at) VALUES(?,?,?,?)").run('already-present', 'active', NOW, NOW);
    assert.throws(() => preexistingAuthority.writer.execute(preexistingAuthority.assertion, preexistingAuthority.command), error => error.code === 'BOOTSTRAP_ALREADY_CONSUMED');
    assert.deepStrictEqual(countRows(preexistingAuthority.db, WRITTEN_TABLES), { ...Object.fromEntries(WRITTEN_TABLES.map(table => [table, 0])), vNext_authorities: 1 });
  } finally { preexistingAuthority.db.close(); }
  const idempotency = await fixture({ idFactory: (() => { let calls = 0; return prefix => `${prefix}-${++calls}`; })() });
  try {
    assert.deepStrictEqual(idempotency.writer.execute(idempotency.assertion, idempotency.command), { authorityId: 'authority-fixture', code: 'AUTHORITY_BOOTSTRAPPED', replayed: false, status: 'accepted' });
    const beforeReplay = countRows(idempotency.db, WRITTEN_TABLES);
    assert.deepStrictEqual(idempotency.writer.execute(idempotency.assertion, idempotency.command), { authorityId: 'authority-fixture', code: 'AUTHORITY_BOOTSTRAPPED', replayed: true, status: 'accepted' });
    assert.deepStrictEqual(countRows(idempotency.db, WRITTEN_TABLES), beforeReplay, 'exact replay must add no durable rows');
    assert.throws(() => idempotency.writer.execute(idempotency.assertion, { ...idempotency.command, reasonCode: 'different-reason' }), error => error.code === 'IDEMPOTENCY_KEY_CONFLICT');
    assert.throws(() => idempotency.writer.execute(idempotency.assertion, { ...idempotency.command, idempotencyKey: 'different-key' }), error => error.code === 'BOOTSTRAP_ALREADY_CONSUMED');
    assert.deepStrictEqual(countRows(idempotency.db, EMPTY_TABLES), Object.fromEntries(EMPTY_TABLES.map(table => [table, 0])), 'bootstrap must not seed unrelated control records');
  } finally { idempotency.db.close(); }
  console.log('vNext first-authority bootstrap reference checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
