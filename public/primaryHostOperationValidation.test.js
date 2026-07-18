const assert = require('assert');
const packageJson = require('../package.json');
const { buildPrimaryHostOperationManifest } = require('./primaryHostOperationValidation');

assert.ok(packageJson.build.files.includes('public/primaryHostOperationValidation.js'));
assert.ok(packageJson.scripts.test.includes('npm run test:primary-host'), 'default npm test must execute the primary-host suite');
assert.ok(packageJson.scripts['test:primary-host'].includes('primaryHostSyncPreflightService.test.js'));
assert.ok(packageJson.scripts['test:primary-host'].includes('primaryHostPreflightProofService.test.js'));
const evidence = {
  runtimeNodeRole: 'desktop-client', dbInstanceDigest: 'a'.repeat(64), schemaVersion: 3107,
  storeId: 'store-1', dbAuthorityId: 'authority-1', quickCheck: 'ok',
};
const backup = {
  authoritative: true, sha256: 'b'.repeat(64), sourceGeneration: 1, targetGeneration: 2,
  createdAt: '2026-07-18T07:00:00.000Z', sizeBytes: 100, artifactName: 'backup.sqlite',
};
const localPreflight = {
  status: 'ok', tablesChecked: 17,
  actor: { userId: 'owner-1', deviceId: 'new-host', sessionId: 'session-1' },
  sourceRowCounts: {}, visibleRowCounts: {},
};
const localPrepared = { evidence, localValidation: { backup, localPreflight } };
const credentialStage = {
  id: 'transfer:challenge-transfer-1',
  deviceId: 'new-host',
  targetGeneration: 2,
  commitment: 'c'.repeat(64),
};
const controlStatus = {
  activeEpoch: {
    id: 'epoch-1', generation: 1, deviceId: 'old-host', activatedAt: '2026-07-18T06:00:00.000Z',
    heartbeat: { status: 'online', updatedAt: '2026-07-18T07:00:00.000Z' },
  },
  transfers: [{
    id: 'transfer-1', status: 'pending_validation', sourceEpochId: 'epoch-1', challengeId: 'challenge-transfer-1', sourceGeneration: 1,
    targetGeneration: 2, targetDeviceId: 'new-host',
  }],
};
assert.deepStrictEqual(buildPrimaryHostOperationManifest({
  operation: 'bootstrap', deviceId: 'new-host', challengeId: 'challenge-bootstrap-1',
  targetGeneration: 1,
  credentialStage: { ...credentialStage, id: 'bootstrap:challenge-bootstrap-1', targetGeneration: 1 },
}), {
  credentialStage: { ...credentialStage, id: 'bootstrap:challenge-bootstrap-1', targetGeneration: 1 },
});
const transfer = buildPrimaryHostOperationManifest({
  operation: 'transfer', deviceId: 'new-host', transferId: 'transfer-1', sourceEpochId: 'epoch-1',
  challengeId: 'challenge-transfer-1', sourceGeneration: 1, targetGeneration: 2,
  localPrepared, controlStatus, credentialStage,
  now: new Date('2026-07-18T07:01:00.000Z'),
});
assert.strictEqual(transfer.backup.sha256, 'b'.repeat(64));
assert.strictEqual(transfer.database.dbInstanceDigest, 'a'.repeat(64));
assert.strictEqual(transfer.questionBank.storeId, 'store-1');
assert.deepStrictEqual(transfer.localPreflight, localPreflight);
assert.deepStrictEqual(transfer.credentialStage, credentialStage);
assert.ok(!Object.hasOwn(transfer, 'cloud'));
assert.ok(!Object.hasOwn(transfer, 'sync'));
assert.deepStrictEqual(transfer.transfer, {
  id: 'transfer-1', sourceEpochId: 'epoch-1', challengeId: 'challenge-transfer-1',
  targetDeviceId: 'new-host', sourceGeneration: 1, targetGeneration: 2,
});
assert.throws(() => buildPrimaryHostOperationManifest({
  operation: 'transfer', deviceId: 'attacker', transferId: 'transfer-1', sourceEpochId: 'epoch-1',
  challengeId: 'challenge-transfer-1', sourceGeneration: 1, targetGeneration: 2,
  localPrepared, controlStatus, credentialStage: { ...credentialStage, deviceId: 'attacker' },
}), error => error.code === 'PRIMARY_HOST_PENDING_TRANSFER_MISMATCH');
assert.throws(() => buildPrimaryHostOperationManifest({
  operation: 'transfer', deviceId: 'new-host', transferId: 'transfer-other', sourceEpochId: 'epoch-1',
  challengeId: 'challenge-transfer-1', sourceGeneration: 1, targetGeneration: 2,
  localPrepared, controlStatus, credentialStage,
}), error => error.code === 'PRIMARY_HOST_PENDING_TRANSFER_MISMATCH');

const recovery = buildPrimaryHostOperationManifest({
  operation: 'recovery', deviceId: 'new-host', sourceGeneration: 1, targetGeneration: 2,
  localPrepared, credentialStage: { ...credentialStage, id: 'recovery:challenge-recovery-1' },
  controlStatus: {
    ...controlStatus,
    transfers: [],
    activeEpoch: {
      ...controlStatus.activeEpoch,
      heartbeat: { status: 'offline', updatedAt: '2026-07-18T06:30:00.000Z' },
    },
  },
  now: new Date('2026-07-18T07:01:00.000Z'),
});
assert.strictEqual(recovery.authoritativeBackup.sha256, 'b'.repeat(64));
assert.strictEqual(recovery.oldHostUnreachable.generation, 1);
assert.ok(recovery.oldHostUnreachable.durationMs >= 15 * 60 * 1000);
assert.ok(recovery.oldHostUnreachable.consecutiveFailures >= 3);
assert.strictEqual(recovery.credentialStage.commitment, 'c'.repeat(64));
assert.throws(() => buildPrimaryHostOperationManifest({
  operation: 'bootstrap', deviceId: 'new-host', challengeId: 'challenge-bootstrap-1', targetGeneration: 1,
  credentialStage: { ...credentialStage, id: 'bootstrap:challenge-bootstrap-1', targetGeneration: 1, commitment: 'not-a-hash' },
}), error => error.code === 'PRIMARY_HOST_CREDENTIAL_STAGE_INVALID');
assert.throws(() => buildPrimaryHostOperationManifest({
  operation: 'recovery', deviceId: 'new-host', sourceGeneration: 1, targetGeneration: 2,
  localPrepared, controlStatus, credentialStage: { ...credentialStage, id: 'recovery:challenge-recovery-1' },
  now: new Date('2026-07-18T07:01:00.000Z'),
}), error => error.code === 'PRIMARY_HOST_OLD_HOST_STILL_REACHABLE');
assert.throws(() => buildPrimaryHostOperationManifest({
  operation: 'transfer', deviceId: 'new-host', transferId: 'transfer-1', sourceEpochId: 'epoch-1',
  challengeId: 'challenge-transfer-1', sourceGeneration: 1, targetGeneration: 2,
  localPrepared: { evidence, localValidation: { backup } }, controlStatus, credentialStage,
}), error => error.code === 'PRIMARY_HOST_LOCAL_PREFLIGHT_FAILED');

console.log('primary host operation validation checks passed');
