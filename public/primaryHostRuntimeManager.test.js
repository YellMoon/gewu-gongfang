const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const packageJson = require('../package.json');
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
  assert.ok(packageJson.build.files.includes('public/primaryHostRuntimeManager.js'));
  const electronSource = fs.readFileSync(path.join(__dirname, 'electron.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  assert.ok(electronSource.includes("require('./primaryHostCredentialStore')"));
  assert.ok(electronSource.includes("require('./primaryHostOperationValidation')"));
  assert.ok(electronSource.includes("require('./primaryHostRuntimeManager')"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:adopt'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:status'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:local-receipt'"));
  assert.ok(electronSource.includes("ipcMain.handle('primary-host:prepare-operation'"));
  assert.ok(electronSource.includes('sourceGeneration: input.sourceGeneration'));
  assert.ok(electronSource.includes('targetGeneration: input.targetGeneration'));
  assert.ok(electronSource.includes('transferId: input.transferId'));
  assert.ok(electronSource.includes('sourceEpochId: input.sourceEpochId'));
  assert.ok(electronSource.includes('operationManifest'));
  assert.ok(electronSource.includes('getPrimaryHostRuntimeManager().stageAdoption'),
    'Electron must persist the candidate host credential before any cloud activation request');
  assert.ok(electronSource.includes('credentialStage'));
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
  const resumedEnv = {};
  const resumedAfterCrash = createPrimaryHostRuntimeManager({ ...dependencies, env: resumedEnv });
  const stagedAfterCrash = resumedAfterCrash.initialize();
  assert.strictEqual(stagedAfterCrash.credential.state, 'staged');
  assert.strictEqual(stagedAfterCrash.config.nodeRole, 'desktop-client');
  const adopted = await resumedAfterCrash.adopt({
    authorization: 'Bearer current-online-session',
    epoch,
    credentialStageId: staged.stageId,
  });
  assert.strictEqual(verified.length, 1);
  assert.strictEqual(verified[0].authorization, 'Bearer current-online-session');
  assert.strictEqual(verified[0].credential, credentialStore.read().credential);
  assert.deepStrictEqual(adopted, {
    state: 'active', active: true, epochId: epoch.id, generation: 2,
    deviceId: epoch.deviceId, userId: epoch.userId, activatedAt: epoch.activatedAt,
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
  assert.strictEqual(restartedEnv.GEWU_PRIMARY_HOST_CREDENTIAL, credentialStore.read().credential);
  assert.strictEqual(restartedEnv.GEWU_PRIMARY_HOST_GENERATION, '2');
  assert.strictEqual(restartedEnv.GEWU_NODE_ROLE, 'primary-host');

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

main().catch(error => { console.error(error); process.exitCode = 1; });
