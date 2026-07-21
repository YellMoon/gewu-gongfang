const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const packageJson = require('../package.json');
const hostBuilderConfig = require('../electron-builder.host.config.cjs');
const {
  DELIVERY_PROTOCOL_VERSION,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  sealRecoveryPackage,
  verifyRecoveryDeliveryAcknowledgement,
} = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol');
const { createPrimaryHostCredentialStore } = require('./primaryHostCredentialStore');
const {
  readRuntimeConfig,
  writeRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  applyRuntimeConfigToEnv,
} = require('./runtimeConfig');
const { createPrimaryHostRuntimeManager } = require('./primaryHostRuntimeManager');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`safe:${Buffer.from(String(value)).toString('base64')}`),
    decryptString: value => Buffer.from(Buffer.from(value).toString().slice(5), 'base64').toString(),
  };
}

async function main() {
  assert.ok(!packageJson.build.files.includes('public/primaryHostRuntimeManager.js'));
  assert.ok(hostBuilderConfig.files.includes('public/primaryHostRuntimeManager.js'));
  const electronSource = fs.readFileSync(path.join(__dirname, 'electron.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  assert.ok(electronSource.includes("require('./primaryHostCredentialStore')"));
  assert.ok(electronSource.includes("require('./primaryHostOperationValidation')"));
  assert.ok(electronSource.includes("require('./primaryHostRuntimeManager')"));
  assert.ok(electronSource.includes("require('../backend/src/services/primaryHostRecoveryDeliveryProtocol')"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:adopt'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:status'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:local-receipt'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:prepare-operation'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:reveal-recovery-package'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:acknowledge-recovery-package'"));
  assert.ok(electronSource.includes('sourceGeneration: input.sourceGeneration'));
  assert.ok(electronSource.includes('targetGeneration: input.targetGeneration'));
  assert.ok(electronSource.includes('transferId: input.transferId'));
  assert.ok(electronSource.includes('sourceEpochId: input.sourceEpochId'));
  assert.ok(electronSource.includes('operationManifest'));
  assert.ok(electronSource.includes('getPrimaryHostRuntimeManager().stageAdoption'),
    'Electron must persist the candidate host credential before any cloud activation request');
  assert.ok(electronSource.includes('credentialStage'));
  assert.ok(electronSource.includes('recoveryDeliveryKey: stagedCredential.recoveryDeliveryKey'));
  assert.ok(electronSource.includes("const credential = String(input.credential || '')"),
    'the adoption verifier must consume the manager-only credential without a renderer plaintext field');
  assert.strictEqual(electronSource.includes("const credential = String(input.hostCredential || '')"), false);
  assert.ok(electronSource.includes('/primary-host/preflight-proofs'));
  assert.ok(electronSource.includes('preflightProof'));
  assert.ok(electronSource.includes('Authorization: normalizedAuthorization'),
    'loopback local preflight must resolve the current authenticated V2 actor');
  assert.ok(electronSource.includes('GEWU_ELECTRON_LOCAL_BRIDGE_SECRET'));
  assert.ok(electronSource.includes("purpose: 'primary-host-receipt'"));
  assert.ok(electronSource.includes('MANAGED_CLOUD_BASE_URL'), 'host credential verification must use the pinned identity control plane');
  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld('primaryHostRuntime'"));
  assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:local-receipt'"));
  assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:prepare-operation'"));
  assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:reveal-recovery-package'"));
  assert.ok(preloadSource.includes("ipcRenderer.invoke('primary-host:acknowledge-recovery-package'"));
  assert.ok(packageJson.build.files.some(entry => entry === 'backend/**/*'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-primary-host-runtime-'));
  const configPath = path.join(root, 'gewugongfang.config.json');
  const credentialPath = path.join(root, 'primary-host-credential-v1.bin');
  writeRuntimeConfig(configPath, {
    deviceId: 'desktop-target-a',
    nodeRole: 'desktop-client',
    mainDbPath: path.join(root, 'scheduling.db'),
  }, { userDataPath: root });
  const credentialStore = createPrimaryHostCredentialStore({ filePath: credentialPath, safeStorage: safeStorage() });
  const env = { GEWU_CLOUD_RELAY_HOST_TOKEN: 'bootstrap-root-must-not-be-used-when-managed' };
  const verified = [];
  const acknowledgements = [];
  const acknowledgementControl = { fail: false, commitThenDrop: false };
  const acknowledgementTime = '2026-07-19T01:05:00.000Z';
  const dependencies = {
    credentialStore,
    configPath,
    userDataPath: root,
    env,
    readRuntimeConfig,
    writeManagedHostRuntimeConfig,
    writeManagedClientRuntimeConfig,
    applyRuntimeConfigToEnv,
    verifyAdoption: async input => {
      verified.push(input);
      return { epoch: { ...input.epoch } };
    },
    now: () => new Date(acknowledgementTime),
    acknowledgeDelivery: async input => {
      acknowledgements.push(input);
      if (acknowledgementControl.fail) throw new Error('simulated acknowledgement outage');
      if (acknowledgementControl.commitThenDrop) {
        throw new Error('simulated response loss after remote commit');
      }
      return {
        recoveryDelivery: {
          id: input.acknowledgement.deliveryId,
          status: 'acknowledged',
          rowVersion: input.acknowledgement.expectedRowVersion + 1,
        },
      };
    },
  };
  const manager = createPrimaryHostRuntimeManager(dependencies);
  const initialized = manager.initialize();
  assert.strictEqual(initialized.config.nodeRole, 'desktop-client');
  assert.deepStrictEqual(initialized.credential, { state: 'empty', active: false });
  assert.ok(!env.GEWU_PRIMARY_HOST_CREDENTIAL);

  const epoch = {
    id: 'epoch-target-2', generation: 2, deviceId: 'desktop-target-a', userId: 'canonical-owner',
    activatedAt: '2026-07-18T03:00:00.000Z',
  };
  const staged = manager.stageAdoption({
    operation: 'transfer',
    challengeId: 'challenge-transfer-2',
    transferId: 'transfer-2',
    targetGeneration: 2,
  });
  assert.strictEqual(staged.state, 'staged');
  assert.strictEqual(staged.active, false);
  assert.strictEqual(staged.generation, 2);
  assert.match(staged.credentialCommitment, /^[a-f0-9]{64}$/);
  assert.ok(!Object.prototype.hasOwnProperty.call(staged, 'credential'));
  assert.strictEqual(staged.recoveryDeliveryKey.protocolVersion, DELIVERY_PROTOCOL_VERSION);
  assert.strictEqual(staged.recoveryDeliveryKey.algorithm, RECOVERY_DELIVERY_KEY_ALGORITHM);
  assert.strictEqual(Object.hasOwn(staged.recoveryDeliveryKey, 'privateKeyPem'), false);
  const repeatedStage = manager.stageAdoption({
    operation: 'transfer',
    challengeId: 'challenge-transfer-2',
    targetGeneration: 2,
  });
  assert.deepStrictEqual(repeatedStage.recoveryDeliveryKey, staged.recoveryDeliveryKey);
  const recoveryPackage = {
    factorId: 'factor-2',
    recoveryCode: 'offline-recovery-code-2-with-more-than-32-characters',
    epochId: epoch.id,
    generation: epoch.generation,
    deviceId: epoch.deviceId,
    createdAt: '2026-07-19T01:00:00.000Z',
  };
  const envelope = sealRecoveryPackage({
    epochId: epoch.id,
    factorId: recoveryPackage.factorId,
    deviceId: epoch.deviceId,
    generation: epoch.generation,
    recoveryPackage,
    recipientKeyAlgorithm: staged.recoveryDeliveryKey.algorithm,
    recipientPublicKeyPem: staged.recoveryDeliveryKey.publicKeyPem,
    recipientPublicKeyFingerprint: staged.recoveryDeliveryKey.publicKeyFingerprint,
  });
  const recoveryDelivery = {
    id: 'delivery-2',
    epochId: epoch.id,
    factorId: recoveryPackage.factorId,
    generation: epoch.generation,
    status: 'pending',
    rowVersion: 1,
    ackNonce: 'b'.repeat(64),
    recipientKeyFingerprint: staged.recoveryDeliveryKey.publicKeyFingerprint,
    envelope,
  };
  const resumedEnv = {};
  const resumedAfterCrash = createPrimaryHostRuntimeManager({ ...dependencies, env: resumedEnv });
  const stagedAfterCrash = resumedAfterCrash.initialize();
  assert.strictEqual(stagedAfterCrash.credential.state, 'staged');
  assert.strictEqual(stagedAfterCrash.config.nodeRole, 'desktop-client');
  const adopted = await resumedAfterCrash.adopt({
    authorization: 'Bearer current-online-session',
    epoch,
    credentialStageId: staged.stageId,
    recoveryDelivery,
  });
  assert.strictEqual(verified.length, 1);
  assert.strictEqual(verified[0].authorization, 'Bearer current-online-session');
  assert.strictEqual(verified[0].credential, credentialStore.read().credential);
  assert.deepStrictEqual(adopted, {
    state: 'active', active: true, epochId: epoch.id, generation: 2,
    deviceId: epoch.deviceId, userId: epoch.userId, activatedAt: epoch.activatedAt,
    recoveryDelivery: { pending: true, deliveryId: 'delivery-2', epochId: epoch.id, rowVersion: 1 },
    restartRequired: true,
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(adopted, 'credential'));
  assert.strictEqual(resumedEnv.GEWU_PRIMARY_HOST_CREDENTIAL, credentialStore.read().credential);
  assert.strictEqual(resumedEnv.GEWU_PRIMARY_HOST_GENERATION, '2');
  assert.strictEqual(resumedEnv.GEWU_NODE_ROLE, 'primary-host');
  const managedConfig = readRuntimeConfig(configPath, { userDataPath: root });
  assert.strictEqual(managedConfig.nodeRole, 'primary-host');
  assert.strictEqual(managedConfig.primaryHostEpochId, epoch.id);
  assert.strictEqual(managedConfig.primaryHostGeneration, 2);

  const restartedEnv = {};
  const restarted = createPrimaryHostRuntimeManager({ ...dependencies, env: restartedEnv });
  const restartState = restarted.initialize();
  assert.strictEqual(restartState.credential.epochId, epoch.id);
  assert.strictEqual(restartState.credential.recoveryDelivery.pending, true);
  assert.strictEqual(restartedEnv.GEWU_PRIMARY_HOST_CREDENTIAL, credentialStore.read().credential);
  assert.strictEqual(restartedEnv.GEWU_PRIMARY_HOST_GENERATION, '2');
  assert.strictEqual(restartedEnv.GEWU_NODE_ROLE, 'primary-host');
  assert.strictEqual(
    restarted.revealRecoveryPackage({ deliveryId: 'delivery-2' }).recoveryPackage.recoveryCode,
    recoveryPackage.recoveryCode
  );
  await assert.rejects(
    restarted.acknowledgeRecoveryPackage({
      authorization: 'Bearer current-online-session',
      deliveryId: 'delivery-2',
      expectedRowVersion: 2,
    }),
    error => error.code === 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT'
  );
  acknowledgementControl.fail = true;
  await assert.rejects(
    restarted.acknowledgeRecoveryPackage({
      authorization: 'Bearer current-online-session',
      deliveryId: 'delivery-2',
      expectedRowVersion: 1,
    }),
    /simulated acknowledgement outage/
  );
  assert.strictEqual(restarted.status().credential.recoveryDelivery.pending, true);
  acknowledgementControl.fail = false;
  acknowledgementControl.commitThenDrop = true;
  await assert.rejects(
    restarted.acknowledgeRecoveryPackage({
      authorization: 'Bearer current-online-session',
      deliveryId: 'delivery-2',
      expectedRowVersion: 1,
    }),
    /simulated response loss after remote commit/
  );
  assert.strictEqual(restarted.status().credential.recoveryDelivery.pending, true);
  acknowledgementControl.commitThenDrop = false;
  const acknowledged = await restarted.acknowledgeRecoveryPackage({
    authorization: 'Bearer current-online-session',
    deliveryId: 'delivery-2',
    expectedRowVersion: 1,
  });
  assert.strictEqual(acknowledged.recoveryDelivery.pending, false);
  assert.strictEqual(acknowledged.restartRequired, true);
  assert.strictEqual(acknowledgements.length, 3);
  assert.deepStrictEqual(acknowledgements[2].acknowledgement, {
    deliveryId: 'delivery-2',
    epochId: epoch.id,
    factorId: 'factor-2',
    recipientKeyFingerprint: staged.recoveryDeliveryKey.publicKeyFingerprint,
    expectedRowVersion: 1,
    acknowledgementNonce: 'b'.repeat(64),
    acknowledgedAt: acknowledgementTime,
  });
  assert.strictEqual(verifyRecoveryDeliveryAcknowledgement({
    acknowledgement: acknowledgements[2].acknowledgement,
    signature: acknowledgements[2].signature,
    publicKeyPem: staged.recoveryDeliveryKey.publicKeyPem,
  }), true);
  assert.strictEqual(Object.hasOwn(credentialStore.read(), 'recoveryDeliveryKey'), false);
  assert.strictEqual(Object.hasOwn(credentialStore.read(), 'pendingRecoveryDelivery'), false);

  await assert.rejects(
    manager.adopt({
      authorization: 'Bearer current-online-session',
      epoch: { ...epoch, id: 'epoch-wrong-device', deviceId: 'desktop-other' },
      credentialStageId: staged.stageId,
    }),
    error => error.code === 'PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH'
  );

  const demoted = manager.demote({ expectedEpochId: epoch.id });
  assert.strictEqual(demoted.config.nodeRole, 'desktop-client');
  assert.deepStrictEqual(demoted.credential, { state: 'empty', active: false });
  assert.ok(!env.GEWU_PRIMARY_HOST_CREDENTIAL);

  const failedStore = createPrimaryHostCredentialStore({
    filePath: path.join(root, 'failed-primary-host.bin'), safeStorage: safeStorage(),
  });
  const failedManager = createPrimaryHostRuntimeManager({
    ...dependencies,
    credentialStore: failedStore,
    verifyAdoption: async () => { throw Object.assign(new Error('rejected'), { code: 'PRIMARY_HOST_CREDENTIAL_INVALID' }); },
  });
  await assert.rejects(
    failedManager.adopt({
      authorization: 'Bearer session', epoch: { ...epoch, generation: 3, id: 'epoch-3' },
      credentialStageId: 'missing-stage',
    }),
    error => error.code === 'PRIMARY_HOST_CREDENTIAL_STAGE_REQUIRED'
  );
  assert.strictEqual(failedStore.read(), null, 'rejected credentials must never reach DPAPI storage');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('primary host runtime manager checks passed');
}

main().then(() => {
  if (process.versions.electron) require('electron').app.exit(0);
}).catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
