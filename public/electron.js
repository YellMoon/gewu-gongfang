const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell, safeStorage, net } = require('electron');
const { acquireDesktopSingleInstance } = require('./electronSingleInstance');
const { createCrossInstallInstanceLock } = require('./electronCrossInstallLock');
let mainWindow;
const DESKTOP_SINGLE_INSTANCE_OWNER = acquireDesktopSingleInstance({ app, getWindow: () => mainWindow });
function activateMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
const crossInstallInstanceLock = DESKTOP_SINGLE_INSTANCE_OWNER
  ? createCrossInstallInstanceLock({
    app,
    userDataPath: app.getPath('userData'),
    activateWindow: activateMainWindow,
  })
  : null;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const { QuestionDraftProvenanceRegistry } = require('./questionDraftProvenanceRegistry');
const fs = require('fs');
const {
  readRuntimeConfig,
  ensureRuntimeConfig,
  writeRuntimeConfig,
  writeManagedHostBootstrapRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  writeManagedDesktopIdentityMode,
  applyRuntimeConfigToEnv,
  MANAGED_CLOUD_BASE_URL,
} = require('./runtimeConfig');
const { buildLanHostUrls } = require('./lanDiscovery');
const { resolveEmbeddedListenHost } = require('./primaryHostListenPolicy');
const { createDesktopIdentityVault } = require('./desktopIdentityVault');
const { createDesktopAuthorityRuntime } = require('./desktopAuthorityRuntime');
const {
  resolveDesktopBuildFlavor,
  updateFeedForFlavor,
  validateDesktopCapabilityManifest,
} = require('./desktopBuildFlavor');
const { resolveConfiguredDesktopIdentityKind } = require('./desktopIdentityKind');
const {
  buildFirewallAuditRequest,
  buildElevatedFirewallRequest,
  parseFirewallAudit,
} = require('./windowsHostFirewall');
const desktopPackage = require('../package.json');
const DESKTOP_BUILD_FLAVOR = resolveDesktopBuildFlavor({
  isPackaged: app.isPackaged,
  metadata: desktopPackage,
  env: process.env,
});
validateDesktopCapabilityManifest({ metadata: desktopPackage, runtimeFlavor: DESKTOP_BUILD_FLAVOR });
process.env.GEWU_DESKTOP_BUILD_FLAVOR = DESKTOP_BUILD_FLAVOR;
const PRIMARY_HOST_CAPABLE = false;
const AUTHORITY_WEBSOCKET_ENABLED = process.env.GEWU_AUTHORITY_WEBSOCKET_DISABLED !== '1';
process.on('unhandledRejection', error => {
  log(`AUTHORITY_RUNTIME_UNHANDLED_REJECTION ${String(error?.code || error?.message || 'UNKNOWN')}`);
});
let createPrimaryHostCredentialStore;
let buildPrimaryHostOperationManifest;
let createPrimaryHostRuntimeManager;
let createPrimaryHostRuntimeStatus;
let createPrimaryHostRelaunchReadiness;
let generateRecoveryDeliveryKeyPair;
let openRecoveryPackage;
let signRecoveryDeliveryAcknowledgement;
if (PRIMARY_HOST_CAPABLE) {
  ({ createPrimaryHostCredentialStore } = require('./primaryHostCredentialStore'));
  ({ buildPrimaryHostOperationManifest } = require('./primaryHostOperationValidation'));
  ({ createPrimaryHostRuntimeManager } = require('./primaryHostRuntimeManager'));
  ({ createPrimaryHostRuntimeStatus } = require('./primaryHostRuntimeStatus'));
  ({ createPrimaryHostRelaunchReadiness } = require('./primaryHostRelaunchReadiness'));
  ({
    generateRecoveryDeliveryKeyPair,
    openRecoveryPackage,
    signRecoveryDeliveryAcknowledgement,
  } = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol'));
}
const { withOperationTimeout } = require('./updateCheckTimeout');
const { requestManagedControlPlane } = require('./managedControlPlaneRequest');
const { buildApplicationMenu, desktopUpdaterErrorMessage, desktopWindowChrome } = require('./electronShellPolicy');
const { ensureLocalSessionSigningSecret } = require('./localSessionSigningSecret');
const { buildRelaunchArguments } = require('./electronRelaunch');
const electronLocalBridgeSecret = crypto.randomBytes(32).toString('base64url');
process.env.GEWU_ELECTRON_LOCAL_BRIDGE_SECRET = electronLocalBridgeSecret;
let autoUpdater = null;
const updateFeedUrl = updateFeedForFlavor(DESKTOP_BUILD_FLAVOR, process.env);
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl });
} catch (err) {
  autoUpdater = null;
}

const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'electron-main.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch(e) {}
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT: ' + err.message + '\n' + err.stack);
});

let backendServer = null;
let hostTaskWakeup = null;
let hostCommandWorker = null;
let authorityProjectionWorker = null;
let primaryHostLocalDraftExecutor = null;
let primaryHostLocalProjectionReader = null;
let desktopIdentityVault = null;
let desktopAuthorityRuntime = null;
let primaryHostRuntimeManager = null;
let primaryHostRuntimeStatus = null;
let primaryHostRelaunchReadiness = null;

function getRuntimeConfigPath() {
  return path.join(app.getPath('userData'), 'gewugongfang.config.json');
}

// The renderer and Electron main process must use the same control plane.  In
// particular, a host may be operating against an explicitly configured
// managed-cloud endpoint during bootstrap; using the compiled-in production
// URL here would let the cloud create an epoch while local credential adoption
// fails against a different control plane.
function getManagedCloudBaseUrl() {
  const runtimeConfig = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
    primaryHostCapable: PRIMARY_HOST_CAPABLE,
  });
  return String(runtimeConfig.cloudBaseUrl || MANAGED_CLOUD_BASE_URL).replace(/\/+$/, '');
}

function resolveEmbeddedRuntimePort(runtimeConfig = {}) {
  if (runtimeConfig.nodeRole === 'primary-host') {
    const configured = String(runtimeConfig.hostBaseUrl || '').trim();
    const match = configured.match(/^https?:\/\/[^/:]+:(\d+)(?:\/|$)/i);
    const port = Number(match?.[1]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return Number(process.env.PORT || 3001);
}

function canStartAuthorityHostRuntime(runtimeConfig = {}) {
  const hostCredential = String(process.env.GEWU_PRIMARY_HOST_CREDENTIAL || '');
  const generation = Number(runtimeConfig.primaryHostGeneration);
  return runtimeConfig.nodeRole === 'primary-host'
    && hostCredential.length >= 16
    && hostCredential.length <= 1024
    && Number.isSafeInteger(generation)
    && generation >= 1;
}

function currentWindowsHostFirewallInput() {
  const runtimeConfig = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
    primaryHostCapable: PRIMARY_HOST_CAPABLE,
  });
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    nodeRole: runtimeConfig.nodeRole,
    executablePath: process.execPath,
    port: resolveEmbeddedRuntimePort(runtimeConfig),
    helperPath: path.join(__dirname, 'windowsHostFirewallElevated.ps1'),
  };
}

function runWindowsFirewallRequest(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

async function readWindowsHostFirewallStatus() {
  const request = buildFirewallAuditRequest(currentWindowsHostFirewallInput());
  if (!request.allowed) return Object.freeze({ state: 'not-available', code: request.reason });
  try {
    const result = await runWindowsFirewallRequest(request);
    const audit = parseFirewallAudit(result.stdout);
    return Object.freeze({ ...audit, exitCode: result.code });
  } catch (error) {
    return Object.freeze({ state: 'error', code: error.code || 'WINDOWS_FIREWALL_AUDIT_FAILED' });
  }
}

async function requestWindowsHostLanFirewall() {
  const request = buildElevatedFirewallRequest({ ...currentWindowsHostFirewallInput(), action: 'ensure' });
  if (!request.allowed) return Object.freeze({ state: 'not-available', code: request.reason });
  try {
    const result = await runWindowsFirewallRequest(request);
    return Object.freeze({
      state: result.code === 0 ? 'elevation-requested' : 'elevation-not-completed',
      code: result.code === 0 ? null : 'WINDOWS_FIREWALL_ELEVATION_NOT_COMPLETED',
    });
  } catch (error) {
    return Object.freeze({ state: 'elevation-not-completed', code: error.code || 'WINDOWS_FIREWALL_ELEVATION_NOT_COMPLETED' });
  }
}

function getDesktopIdentityVault() {
  if (desktopIdentityVault) return desktopIdentityVault;
  desktopIdentityVault = createDesktopIdentityVault({
    filePath: path.join(app.getPath('userData'), 'desktop-identity-v2.bin'),
    legacyFilePath: path.join(app.getPath('userData'), 'desktop-session.bin'),
    safeStorage,
  });
  return desktopIdentityVault;
}

function getDesktopAuthorityRuntime() {
  if (desktopAuthorityRuntime) return desktopAuthorityRuntime;
  const runtimeConfig = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
    primaryHostCapable: PRIMARY_HOST_CAPABLE,
  });
  desktopAuthorityRuntime = createDesktopAuthorityRuntime({
    filePath: path.join(app.getPath('userData'), 'desktop-authority-outbox.bin'),
    safeStorage,
    vault: getDesktopIdentityVault(),
    lanBaseUrl: runtimeConfig.hostBaseUrl,
    relayWebSocketBaseUrl: runtimeConfig.cloudBaseUrl,
    durableRelayBaseUrl: runtimeConfig.cloudBaseUrl,
    WebSocketImpl: AUTHORITY_WEBSOCKET_ENABLED ? WebSocket : undefined,
    isOnline: () => net.isOnline(),
  });
  return desktopAuthorityRuntime;
}

async function verifyPrimaryHostAdoption(input = {}) {
  const authorization = String(input.authorization || '').trim();
  const epoch = input.epoch && typeof input.epoch === 'object' ? input.epoch : {};
  const credential = String(input.credential || '');
  if (!authorization.startsWith('Bearer ') || authorization.length > 16384 || !credential) {
    const error = new Error('PRIMARY_HOST_ADOPTION_AUTHORIZATION_REQUIRED');
    error.code = 'PRIMARY_HOST_ADOPTION_AUTHORIZATION_REQUIRED';
    throw error;
  }
  const controlPlaneBaseUrl = getManagedCloudBaseUrl();
  log(`[primary-host:adopt] control-plane-port=${new URL(controlPlaneBaseUrl).port || 'default'}`);
  const response = await requestManagedControlPlane(`${controlPlaneBaseUrl}/api/desktop-identity/primary-host/credentials/verify`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      epochId: epoch.id,
      deviceId: epoch.deviceId,
      generation: epoch.generation,
      credential,
    }),
    timeoutMs: 15000,
  });
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = new Error('PRIMARY_HOST_ADOPTION_RESPONSE_INVALID');
    error.code = 'PRIMARY_HOST_ADOPTION_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }
  if (!response.ok || payload?.success !== true || !payload?.data?.epoch) {
    const error = new Error(payload?.code || 'PRIMARY_HOST_ADOPTION_REJECTED');
    error.code = payload?.code || 'PRIMARY_HOST_ADOPTION_REJECTED';
    throw error;
  }
  return payload.data;
}

async function acknowledgePrimaryHostRecoveryDelivery(input = {}) {
  const authorization = String(input.authorization || '').trim();
  const acknowledgement = input.acknowledgement && typeof input.acknowledgement === 'object'
    ? input.acknowledgement
    : {};
  const deliveryId = String(acknowledgement.deliveryId || '').trim();
  if (!authorization.startsWith('Bearer ') || authorization.length > 16384 || !deliveryId) {
    const error = new Error('PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED');
    error.code = 'PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED';
    throw error;
  }
  const { deliveryId: _pathDeliveryId, ...acknowledgementBody } = acknowledgement;
  const response = await requestManagedControlPlane(
    `${getManagedCloudBaseUrl()}/api/desktop-identity/primary-host/recovery-deliveries/${encodeURIComponent(deliveryId)}/acknowledge`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify({ ...acknowledgementBody, signature: input.signature }),
      timeoutMs: 15000,
    }
  );
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = new Error('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_RESPONSE_INVALID');
    error.code = 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }
  if (!response.ok || payload?.success !== true || !payload?.data?.recoveryDelivery) {
    const error = new Error(payload?.code || 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_REJECTED');
    error.code = payload?.code || 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_REJECTED';
    throw error;
  }
  return payload.data;
}

function getPrimaryHostRuntimeManager() {
  if (!PRIMARY_HOST_CAPABLE) {
    const error = new Error('PRIMARY_HOST_BUILD_REQUIRED');
    error.code = 'PRIMARY_HOST_BUILD_REQUIRED';
    throw error;
  }
  if (primaryHostRuntimeManager) return primaryHostRuntimeManager;
  const userDataPath = app.getPath('userData');
  const credentialStore = createPrimaryHostCredentialStore({
    filePath: path.join(userDataPath, 'primary-host-credential-v1.bin'),
    safeStorage,
  });
  primaryHostRuntimeManager = createPrimaryHostRuntimeManager({
    credentialStore,
    configPath: getRuntimeConfigPath(),
    userDataPath,
    env: process.env,
    readRuntimeConfig: ensureRuntimeConfig,
    writeManagedHostBootstrapRuntimeConfig,
    writeManagedHostRuntimeConfig,
    writeManagedClientRuntimeConfig,
    writeManagedDesktopIdentityMode,
    applyRuntimeConfigToEnv,
    verifyAdoption: verifyPrimaryHostAdoption,
    acknowledgeDelivery: acknowledgePrimaryHostRecoveryDelivery,
    generateRecoveryDeliveryKeyPair,
    openRecoveryPackage,
    signRecoveryDeliveryAcknowledgement,
  });
  return primaryHostRuntimeManager;
}

function getPrimaryHostRuntimeStatus() {
  if (!PRIMARY_HOST_CAPABLE) throw Object.assign(new Error('PRIMARY_HOST_BUILD_REQUIRED'), { code: 'PRIMARY_HOST_BUILD_REQUIRED' });
  if (!primaryHostRuntimeStatus) primaryHostRuntimeStatus = createPrimaryHostRuntimeStatus();
  return primaryHostRuntimeStatus;
}

function getPrimaryHostRelaunchReadiness() {
  if (!PRIMARY_HOST_CAPABLE) throw Object.assign(new Error('PRIMARY_HOST_BUILD_REQUIRED'), { code: 'PRIMARY_HOST_BUILD_REQUIRED' });
  if (!primaryHostRelaunchReadiness) primaryHostRelaunchReadiness = createPrimaryHostRelaunchReadiness({ userDataPath: app.getPath('userData') });
  return primaryHostRelaunchReadiness;
}

async function readPrimaryHostControlStatus(authorization) {
  const normalizedAuthorization = String(authorization || '').trim();
  if (!normalizedAuthorization.startsWith('Bearer ') || normalizedAuthorization.length > 16384) {
    const error = new Error('PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED');
    error.code = 'PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED';
    throw error;
  }
  const response = await requestManagedControlPlane(`${getManagedCloudBaseUrl()}/api/desktop-identity/primary-host/status`, {
    headers: { Accept: 'application/json', Authorization: normalizedAuthorization },
    timeoutMs: 15000,
  });
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = new Error('PRIMARY_HOST_CONTROL_RESPONSE_INVALID');
    error.code = 'PRIMARY_HOST_CONTROL_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }
  if (!response.ok || payload?.success !== true || !payload?.data) {
    const error = new Error(payload?.code || 'PRIMARY_HOST_CONTROL_UNAVAILABLE');
    error.code = payload?.code || 'PRIMARY_HOST_CONTROL_UNAVAILABLE';
    throw error;
  }
  return payload.data;
}

async function preparePrimaryHostOperation(input = {}) {
  const normalizedAuthorization = String(input.authorization || '').trim();
  if (!normalizedAuthorization.startsWith('Bearer ') || normalizedAuthorization.length > 16384) {
    const error = new Error('PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED');
    error.code = 'PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED';
    throw error;
  }
  const stagedCredential = getPrimaryHostRuntimeManager().stageAdoption({
    operation: input.operation,
    challengeId: input.challengeId,
    targetGeneration: input.targetGeneration,
    replaceStaleBootstrapStage: input.operation === 'bootstrap'
      && input.physicalConfirmation === 'I_AM_PHYSICALLY_AT_THIS_DEVICE',
  });
  const credentialStage = Object.freeze({
    id: stagedCredential.stageId,
    deviceId: stagedCredential.deviceId,
    targetGeneration: stagedCredential.generation,
    commitment: stagedCredential.credentialCommitment,
    hostSigningKey: stagedCredential.hostSigningKey,
  });
  const port = Number(process.env.PORT || 3001);
  const response = await fetch(`http://127.0.0.1:${port}/api/desktop-identity/primary-host/local-evidence`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: normalizedAuthorization,
      'x-gewu-electron-local-bridge': electronLocalBridgeSecret,
    },
    body: JSON.stringify({
      purpose: input.operation,
      sourceGeneration: input.sourceGeneration,
      targetGeneration: input.targetGeneration,
    }),
    signal: AbortSignal.timeout(15000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = new Error('PRIMARY_HOST_LOCAL_EVIDENCE_RESPONSE_INVALID');
    error.code = 'PRIMARY_HOST_LOCAL_EVIDENCE_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }
  if (!response.ok || payload?.success !== true || !payload?.data?.evidence) {
    const error = new Error(payload?.code || 'PRIMARY_HOST_LOCAL_EVIDENCE_FAILED');
    error.code = payload?.code || 'PRIMARY_HOST_LOCAL_EVIDENCE_FAILED';
    throw error;
  }
  const runtimeConfig = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
  });
  const deviceId = String(process.env.GEWU_DEVICE_ID || runtimeConfig.deviceId || '').trim();
  const controlStatus = input.operation === 'bootstrap'
    ? null
    : await readPrimaryHostControlStatus(input.authorization);
  const operationManifest = buildPrimaryHostOperationManifest({
    operation: input.operation,
    deviceId,
    transferId: input.transferId,
    sourceEpochId: input.sourceEpochId,
    challengeId: input.challengeId,
    sourceGeneration: input.sourceGeneration,
    targetGeneration: input.targetGeneration,
    localPrepared: payload.data,
    controlStatus,
    credentialStage,
    recoveryDeliveryKey: stagedCredential.recoveryDeliveryKey,
  });
  const signed = getDesktopIdentityVault().signChallenge({
    purpose: 'primary-host-receipt',
    operation: input.operation,
    challengeId: input.challengeId,
    physicalConfirmation: input.physicalConfirmation,
    evidence: payload.data.evidence,
    operationManifest,
  });
  const localReceipt = Object.freeze({ receipt: signed.receipt, signature: signed.signature });
  if (input.operation === 'bootstrap') {
    return Object.freeze({
      localReceipt,
      operationManifest,
      credentialStage,
      recoveryDeliveryKey: stagedCredential.recoveryDeliveryKey,
      preflightProof: null,
    });
  }
  const proofResponse = await requestManagedControlPlane(
    `${getManagedCloudBaseUrl()}/api/desktop-identity/primary-host/preflight-proofs`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: normalizedAuthorization,
      },
      body: JSON.stringify({
        operation: input.operation,
        challengeId: input.challengeId,
        transferId: input.transferId,
        sourceEpochId: input.sourceEpochId || controlStatus?.activeEpoch?.id,
        sourceGeneration: input.sourceGeneration,
        targetGeneration: input.targetGeneration,
        operationManifest,
        localReceipt,
      }),
      timeoutMs: 15000,
    }
  );
  let proofPayload;
  try {
    proofPayload = await proofResponse.json();
  } catch (cause) {
    const error = new Error('PRIMARY_HOST_PREFLIGHT_PROOF_RESPONSE_INVALID');
    error.code = 'PRIMARY_HOST_PREFLIGHT_PROOF_RESPONSE_INVALID';
    error.cause = cause;
    throw error;
  }
  const preflight = proofPayload?.data?.preflight;
  if (!proofResponse.ok || proofPayload?.success !== true || !preflight?.id || !preflight?.token
    || preflight?.cloudPreflight?.status !== 'ok' || !preflight?.operationManifest) {
    const error = new Error(proofPayload?.code || 'PRIMARY_HOST_PREFLIGHT_PROOF_FAILED');
    error.code = proofPayload?.code || 'PRIMARY_HOST_PREFLIGHT_PROOF_FAILED';
    throw error;
  }
  return Object.freeze({
    localReceipt,
    operationManifest: Object.freeze(preflight.operationManifest),
    credentialStage: Object.freeze(preflight.operationManifest.credentialStage),
    recoveryDeliveryKey: stagedCredential.recoveryDeliveryKey,
    preflightProof: Object.freeze({ id: preflight.id, token: preflight.token, expiresAt: preflight.expiresAt }),
  });
}

async function issuePrimaryHostLocalReceipt(input = {}) {
  const prepared = await preparePrimaryHostOperation(input);
  return prepared.localReceipt;
}

function configuredDesktopIdentity(input = {}, options = {}) {
  const runtimeConfig = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
    primaryHostCapable: PRIMARY_HOST_CAPABLE,
  });
  const deviceId = String(process.env.GEWU_DEVICE_ID || runtimeConfig.deviceId || '').trim();
  if (!deviceId) {
    const error = new Error('DESKTOP_IDENTITY_DEVICE_ID_REQUIRED');
    error.code = 'DESKTOP_IDENTITY_DEVICE_ID_REQUIRED';
    throw error;
  }
  return {
    deviceId,
    deviceName: String(input.deviceName || runtimeConfig.deviceName || os.hostname()).trim().slice(0, 128),
    deviceKind: resolveConfiguredDesktopIdentityKind({
      primaryHostCapable: PRIMARY_HOST_CAPABLE,
      nodeRole: runtimeConfig.nodeRole,
      desktopIdentityMode: runtimeConfig.desktopIdentityMode,
    }),
  };
}

function lockDesktopIdentityVault() {
  try { desktopIdentityVault?.lock(); } catch (_error) { /* best effort */ }
}

function loadAndApplyRuntimeConfig() {
  if (!PRIMARY_HOST_CAPABLE) {
    const configPath = getRuntimeConfigPath();
    const options = { userDataPath: app.getPath('userData') };
    let config = ensureRuntimeConfig(configPath, options);
    if (config.nodeRole !== 'desktop-client' || config.primaryHostEpochId || config.primaryHostGeneration) {
      config = writeManagedClientRuntimeConfig(configPath, {
        deviceId: config.deviceId,
        expectedEpochId: config.primaryHostEpochId || '',
      }, options);
      log('Ordinary desktop build forced stale primary-host runtime state back to desktop-client');
    }
    applyRuntimeConfigToEnv(config, process.env);
    return config;
  }
  const state = getPrimaryHostRuntimeManager().initialize();
  if (state.credential.state === 'error') {
    log(`Primary host credential failed closed: ${state.credential.code}`);
  }
  return state.config;
}

function findBackendApp() {
  const candidates = [
    path.join(process.resourcesPath || '', 'backend', 'src', 'app.js'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'backend', 'src', 'app.js'),
    path.join(app.getAppPath(), 'backend', 'src', 'app.js'),
    path.join(__dirname, '..', 'backend', 'src', 'app.js'),
    path.join(process.cwd(), 'backend', 'src', 'app.js'),
  ];
  for (const p of candidates) {
    log('Backend app candidate: ' + p + ' exists=' + fs.existsSync(p));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findBundledPython() {
  const candidates = [
    path.join(process.resourcesPath || '', 'runtime', 'python', 'python.exe'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'runtime', 'python', 'python.exe'),
    path.join(app.getAppPath(), 'runtime', 'python', 'python.exe'),
    path.join(__dirname, '..', 'runtime', 'python', 'python.exe'),
    path.join(process.cwd(), 'runtime', 'python', 'python.exe'),
  ];
  for (const p of candidates) {
    log('Python runtime candidate: ' + p + ' exists=' + fs.existsSync(p));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startBackendService() {
  if (process.env.DISABLE_EMBEDDED_BACKEND === '1') return;
  const appPath = findBackendApp();
  if (!appPath) {
    log('Backend app.js not found, embedded backend disabled');
    return;
  }
  try {
    const runtimeConfig = loadAndApplyRuntimeConfig();
    ensureLocalSessionSigningSecret(process.env, electronLocalBridgeSecret);
    log('Runtime config loaded: role=' + runtimeConfig.nodeRole + ' device=' + runtimeConfig.deviceId);
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    if (runtimeConfig.nodeRole === 'primary-host') {
      const embeddedPort = resolveEmbeddedRuntimePort(runtimeConfig);
      log(`Primary host embedded port: hostBaseUrl=${String(runtimeConfig.hostBaseUrl || '')} resolved=${embeddedPort}`);
      process.env.PORT = String(embeddedPort);
    } else {
      process.env.PORT = process.env.PORT || '3001';
    }
    const listenHost = resolveEmbeddedListenHost({ nodeRole: runtimeConfig.nodeRole, config: runtimeConfig });
    log(`Primary host listener scope: role=${runtimeConfig.nodeRole} configured=${String(runtimeConfig.primaryHostListenScope || 'lan')} resolved=${listenHost}`);
    if (runtimeConfig.nodeRole === 'primary-host' && listenHost !== '127.0.0.1') {
      const lanUrls = buildLanHostUrls({ port: process.env.PORT });
      process.env.GEWU_HOST_LAN_URLS = JSON.stringify(lanUrls);
      log('Host LAN URLs: ' + lanUrls.join(','));
    }
    const appDataDir = app.getPath('userData');
    process.env.GEWU_DATA_DIR = process.env.GEWU_DATA_DIR || appDataDir;
    process.env.DB_PATH = process.env.DB_PATH || runtimeConfig.mainDbPath || path.join(appDataDir, 'data', 'scheduling.db');
    process.env.QUESTION_BANK_UPLOAD_DIR = process.env.QUESTION_BANK_UPLOAD_DIR
      || runtimeConfig.questionAssetPath
      || path.join(appDataDir, 'uploads', 'question-bank');
    const bundledPython = findBundledPython();
    if (bundledPython) process.env.PYTHON_BIN = process.env.PYTHON_BIN || bundledPython;
    const nodePath = path.join(app.getAppPath(), 'node_modules');
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}${path.delimiter}${nodePath}` : nodePath;
    require('module').Module._initPaths();
    const { createApp } = require(appPath);
    const backendApp = createApp();
    backendServer = backendApp.listen(Number(process.env.PORT), listenHost, async () => {
      log(`Embedded backend listening on ${listenHost}:${process.env.PORT}`);
      if (canStartAuthorityHostRuntime(runtimeConfig)) {
        const { getInstance } = require('../backend/src/database');
        const { createAuthorityHostRuntime } = require('../backend/src/services/authorityHostRuntime');
        const {
          createAuthorityCommandSource,
          publishAuthorityControlRecords,
          readAuthorityControlRecords,
          readAuthorityHostEpoch,
          publishAuthorityHostEpoch,
          publishAuthorityProjection,
        } = require('../backend/src/services/cloudRelayClient');
        const { createAuthorityCompositeCommandSource } = require('../backend/src/services/authorityCompositeCommandSource');
        const { createAuthoritySocketCommandHandler } = require('../backend/src/services/authoritySocketCommandHandler');
        const { createAuthorityDeviceControlCache } = require('../backend/src/services/authorityDeviceControlCache');
        const { createAuthorityRuntimeHostEpochService } = require('../backend/src/services/authorityRuntimeHostEpochService');
        const { createAuthorityProjectionPublisherService } = require('../backend/src/services/authorityProjectionPublisherService');
        const { createAuthorityProjectionSourceService } = require('../backend/src/services/authorityProjectionSourceService');
        const {
          createAuthorityControlMirrorSourceService,
        } = require('../backend/src/services/authorityControlMirrorSourceService');
        const { createAuthorityProjectionWorker } = require('../backend/src/services/authorityProjectionWorker');
        const {
          derivePrimaryHostSigningKey,
          signPrimaryHostProjection,
        } = require('./primaryHostSigningKey');
        const { AuthoritySocketServer } = require('../backend/src/websocket/authoritySocketServer');
        const { createHostCommandWorker } = require('../backend/src/services/hostCommandWorker');
        const managedHostAuth = Object.freeze({
          hostCredential: process.env.GEWU_PRIMARY_HOST_CREDENTIAL,
          hostDeviceId: runtimeConfig.deviceId,
          hostGeneration: runtimeConfig.primaryHostGeneration,
        });
        const derivedHostSigningKey = derivePrimaryHostSigningKey(managedHostAuth.hostCredential);
        const hostSigningKey = Object.freeze({
          algorithm: derivedHostSigningKey.algorithm,
          publicKeyPem: derivedHostSigningKey.publicKeyPem,
          publicKeyFingerprint: derivedHostSigningKey.publicKeyFingerprint,
        });
        const runtimeHostEpochs = createAuthorityRuntimeHostEpochService({ db: getInstance().db });
        const remoteEpoch = await readAuthorityHostEpoch(managedHostAuth);
        runtimeHostEpochs.install({ epoch: remoteEpoch?.epoch, hostSigningKey });
        const cloudSource = createAuthorityCommandSource(managedHostAuth);
        const commandSource = createAuthorityCompositeCommandSource({
          sources: [
            { id: 'local', source: backendApp.locals.authorityCommandInbox },
            { id: 'cloud', source: cloudSource },
          ],
        });
        const controlCache = createAuthorityDeviceControlCache({ db: getInstance().db });
        const refreshControlRecords = async () => {
          const response = await readAuthorityControlRecords(managedHostAuth);
          if (!response?.snapshot) throw Object.assign(new Error('AUTHORITY_DEVICE_CONTROL_MIRROR_UNAVAILABLE'), { code: 'AUTHORITY_DEVICE_CONTROL_MIRROR_UNAVAILABLE' });
          return controlCache.replace(response.snapshot);
        };
        const authorityRuntime = createAuthorityHostRuntime({
          database: getInstance(),
          targetHostId: runtimeConfig.deviceId,
          commandSource,
        });
        const projectionSource = createAuthorityProjectionSourceService({
          db: getInstance().db,
        });
        const controlMirrorSource = createAuthorityControlMirrorSourceService({
          db: getInstance().db,
        });
        const projectionPublisher = createAuthorityProjectionPublisherService({
          db: getInstance().db,
          loadSource: input => projectionSource.load(input),
          prepareRemote: async target => {
            await publishAuthorityHostEpoch({
              id: target.hostEpochId,
              authorityId: target.authorityId,
              generation: runtimeConfig.primaryHostGeneration,
              deviceId: runtimeConfig.deviceId,
              hostSigningKey,
            }, managedHostAuth);
            return publishAuthorityControlRecords(controlMirrorSource.load(target), managedHostAuth);
          },
          signProjection: input => signPrimaryHostProjection({
            hostCredential: managedHostAuth.hostCredential,
            projection: input,
          }),
          publishRemote: projection => publishAuthorityProjection(projection, managedHostAuth),
        });
        // The cloud owns the bootstrap grant/lease record. Pull it into the
        // host's copy before the projection worker is allowed to publish any
        // snapshot, otherwise a pre-bootstrap local copy could overwrite that
        // newly issued control record on its first wake.
        await refreshControlRecords();
        authorityProjectionWorker = createAuthorityProjectionWorker({
          db: getInstance().db,
          publisher: projectionPublisher,
          targetHostId: runtimeConfig.deviceId,
          intervalMs: 15000,
          log,
        });
        authorityProjectionWorker.start();
        hostCommandWorker = createHostCommandWorker({
          processOnce: async () => {
            await refreshControlRecords();
            const result = await authorityRuntime.processor.processOnce();
            if (Number(result?.processed || 0) > 0) void authorityProjectionWorker?.wake();
            return result;
          },
          log,
        });
        hostCommandWorker.start();
        void authorityProjectionWorker.wake();
        const { createPrimaryHostLocalDraftExecutor } = require('./primaryHostLocalDraftExecutor');
        const { createPrimaryHostLocalProjectionReader } = require('./primaryHostLocalProjectionReader');
        const { createAuthorityProjectionStoreService } = require('../backend/src/services/authorityProjectionStoreService');
        const hostAuthorityContext = () => {
          const vaultStatus = getDesktopIdentityVault().status();
          if (!vaultStatus?.unlocked) {
            throw Object.assign(new Error('PRIMARY_HOST_LOCAL_OPERATOR_UNLOCK_REQUIRED'), { code: 'PRIMARY_HOST_LOCAL_OPERATOR_UNLOCK_REQUIRED' });
          }
          const epoch = runtimeHostEpochs.findForDevice(runtimeConfig.deviceId);
          if (!epoch?.id || !epoch?.authority_id || !epoch?.device_id) {
            throw Object.assign(new Error('PRIMARY_HOST_LOCAL_EPOCH_REQUIRED'), { code: 'PRIMARY_HOST_LOCAL_EPOCH_REQUIRED' });
          }
          const control = getInstance().db.prepare(`SELECT g.user_id, g.device_id, g.grant_version, l.lease_id, l.active_role
            FROM device_grants g JOIN device_leases l ON l.grant_id=g.grant_id
            WHERE g.authority_id=? AND g.device_id=? AND g.status='active'
              AND l.authority_id=? AND l.status='active' AND l.revoked_at IS NULL
            ORDER BY l.expires_at DESC LIMIT 1`)
            .get(epoch.authority_id, epoch.device_id, epoch.authority_id);
          if (!control?.user_id || !control?.device_id || !control?.lease_id || !control?.active_role) {
            throw Object.assign(new Error('PRIMARY_HOST_LOCAL_CONTROL_REQUIRED'), { code: 'PRIMARY_HOST_LOCAL_CONTROL_REQUIRED' });
          }
          if (String(vaultStatus?.user?.id || '') !== String(control.user_id)) {
            throw Object.assign(new Error('PRIMARY_HOST_LOCAL_OPERATOR_USER_MISMATCH'), { code: 'PRIMARY_HOST_LOCAL_OPERATOR_USER_MISMATCH' });
          }
          if (String(vaultStatus?.activeRole || '') !== String(control.active_role)) {
            throw Object.assign(new Error('PRIMARY_HOST_LOCAL_OPERATOR_ROLE_MISMATCH'), { code: 'PRIMARY_HOST_LOCAL_OPERATOR_ROLE_MISMATCH' });
          }
          return Object.freeze({
            authorityId: epoch.authority_id,
            hostEpochId: epoch.id,
            actor: Object.freeze({ userId: control.user_id, deviceId: control.device_id, role: control.active_role }),
            lease: Object.freeze({ id: control.lease_id, grantVersion: Number(control.grant_version) }),
          });
        };
        primaryHostLocalProjectionReader = createPrimaryHostLocalProjectionReader({
          refreshControlRecords,
          hostAuthorityContext,
          resolveHostEpoch: hostEpochId => runtimeHostEpochs.find(hostEpochId),
          materializeProjections: target => projectionPublisher.materializeAll(target),
          projectionStore: createAuthorityProjectionStoreService({ db: getInstance().db }),
          db: getInstance().db,
        });
        primaryHostLocalDraftExecutor = createPrimaryHostLocalDraftExecutor({
          refreshControlRecords,
          hostAuthorityContext,
          authorityExecutor: authorityRuntime.executor,
          projectionWorker: authorityProjectionWorker,
        });
        const socketHandler = createAuthoritySocketCommandHandler({
          deviceAuth: backendApp.locals.authorityDeviceRequestAuth,
          authorizeCommand: envelope => backendApp.locals.authorityCommandAuthorization.authorize(envelope),
          inbox: backendApp.locals.authorityCommandInbox,
          worker: hostCommandWorker,
          refreshControlRecords,
        });
        if (AUTHORITY_WEBSOCKET_ENABLED) {
          backendApp.set('authoritySocketServer', new AuthoritySocketServer(backendServer, {
            handler: socketHandler,
          }));
        }
        const { createHostTaskWakeup } = require('../backend/src/websocket/hostTaskWakeup');
        hostTaskWakeup = createHostTaskWakeup({
          runtimeConfig,
          localPort: Number(process.env.PORT),
          worker: hostCommandWorker,
          authorityFrameHandler: socketHandler,
          log,
        });
        hostTaskWakeup?.start();
        const runtimeStatus = getPrimaryHostRuntimeStatus();
        runtimeStatus.bindWorker(hostCommandWorker);
        runtimeStatus.bindProjectionWorker(authorityProjectionWorker);
        runtimeStatus.bindWakeup(hostTaskWakeup);
        runtimeStatus.markBackendListening({ host: listenHost, port: Number(process.env.PORT) });
        getPrimaryHostRelaunchReadiness().markReady({ host: listenHost, port: Number(process.env.PORT) });
      } else if (runtimeConfig.nodeRole === 'primary-host') {
        log('AUTHORITY_RUNTIME_DEFERRED_UNTIL_HOST_CREDENTIAL');
        const runtimeStatus = getPrimaryHostRuntimeStatus();
        runtimeStatus.markBackendListening({ host: listenHost, port: Number(process.env.PORT) });
        getPrimaryHostRelaunchReadiness().markReady({ host: listenHost, port: Number(process.env.PORT) });
      }
    });
    backendServer.on('error', err => {
      log('Embedded backend error: ' + err.message);
      if (runtimeConfig.nodeRole === 'primary-host') {
        getPrimaryHostRuntimeStatus().markBackendFailed(err);
        getPrimaryHostRelaunchReadiness().markFailed(err);
      }
    });
  } catch (err) {
    log('Embedded backend start failed: ' + err.message + '\n' + err.stack);
    if (PRIMARY_HOST_CAPABLE) {
      getPrimaryHostRuntimeStatus().markBackendFailed(err);
      getPrimaryHostRelaunchReadiness().markFailed(err);
    }
  }
}

function createWindow() {
  log('createWindow, cwd=' + process.cwd());
  log('__dirname=' + __dirname);
  log('app.getAppPath=' + app.getAppPath());

  const windowChrome = desktopWindowChrome();
  Menu.setApplicationMenu(buildApplicationMenu({ isPackaged: app.isPackaged, menuApi: Menu }));

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    minWidth: 1200,
    minHeight: 800,
    frame: true,
    backgroundColor: '#ffffff',
    show: false,
    title: '格物工坊',
    autoHideMenuBar: windowChrome.autoHideMenuBar,
    menuBarVisible: windowChrome.menuBarVisible,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--gewu-desktop-build-flavor=${DESKTOP_BUILD_FLAVOR}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      enableRemoteModule: false,
      webSecurity: true,
    }
  });
  mainWindow.setAutoHideMenuBar(windowChrome.autoHideMenuBar);
  mainWindow.setMenuBarVisibility(windowChrome.menuBarVisible);

  // 打开时最大化
  mainWindow.maximize();

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
    mainWindow.show();
  } else {
    const candidates = [
      path.join(__dirname, '..', 'build', 'index.html'),
      path.join(__dirname, 'build', 'index.html'),
      path.join(process.resourcesPath, 'app.asar', 'build', 'index.html'),
      path.join(path.dirname(process.execPath), 'build', 'index.html'),
      // Source launches also contain CRA's uncompiled public/index.html. Keep it
      // as a last-resort diagnostic fallback so it can never shadow build/.
      path.join(__dirname, 'index.html'),
    ];

    let indexPath = null;
    for (const p of candidates) {
      log('Try: ' + p + ' exists=' + fs.existsSync(p));
      if (fs.existsSync(p)) {
        indexPath = p;
        break;
      }
    }

    if (indexPath) {
      log('Using indexPath=' + indexPath);
      mainWindow.loadFile(indexPath).then(() => {
        log('loadFile OK');
        mainWindow.show();
      }).catch(err => {
        log('loadFile failed: ' + err.message + ', trying loadURL...');
        const fileUrl = 'file:///' + indexPath.replace(/\\/g, '/');
        mainWindow.loadURL(fileUrl).then(() => {
          log('loadURL OK');
          mainWindow.show();
        }).catch(err2 => {
          log('loadURL also failed: ' + err2.message);
          showErrorPage('加载失败: ' + err2.message);
        });
      });
    } else {
      log('All paths failed!');
      showErrorPage('找不到应用文件');
    }
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl && /^https?:\/\//.test(url) && !url.startsWith('http://localhost:3000')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    log('did-fail-load: ' + code + ' ' + desc);
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    log('render-process-gone: ' + details.reason + ' ' + details.exitCode);
  });
  mainWindow.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) log('[Renderer ERROR] ' + msg);
    else if (level === 1) log('[Renderer WARN] ' + msg);
  });
}

function showErrorPage(msg) {
  const html = `<html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;padding:50px;background:#fff">
    <h2>⚠️ ${msg}</h2>
    <p>请尝试用命令行启动查看详细日志：</p>
    <code>"${process.execPath}"</code>
    <p>日志位置：${logFile}</p>
  </body></html>`;
  mainWindow.loadURL('data:text/html,' + encodeURIComponent(html));
  mainWindow.show();
}

if (DESKTOP_SINGLE_INSTANCE_OWNER) {
  Promise.all([app.whenReady(), crossInstallInstanceLock.ready]).then(([, crossInstallOwner]) => {
    if (!crossInstallOwner) return;
    log('whenReady');
    if (PRIMARY_HOST_CAPABLE) getPrimaryHostRelaunchReadiness().beginLaunch();
    startBackendService();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch(error => {
    log(`CROSS_INSTALL_INSTANCE_LOCK_FAILED ${String(error?.code || error?.message || 'UNKNOWN')}`);
    app.quit();
  });
}

app.on('window-all-closed', () => {
  lockDesktopIdentityVault();
  hostTaskWakeup?.stop();
  hostTaskWakeup = null;
  hostCommandWorker?.stop();
  hostCommandWorker = null;
  authorityProjectionWorker?.stop();
  authorityProjectionWorker = null;
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void crossInstallInstanceLock?.close();
  lockDesktopIdentityVault();
  hostTaskWakeup?.stop();
  hostTaskWakeup = null;
  hostCommandWorker?.stop();
  hostCommandWorker = null;
  authorityProjectionWorker?.stop();
  authorityProjectionWorker = null;
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-user-data-path', () => app.getPath('userData'));
const questionDraftRegistry = new QuestionDraftProvenanceRegistry({
  filePath: path.join(app.getPath('userData'), 'question-draft-provenance.json'),
  tokenVerifier: async rawToken => {
    const port = Number(process.env.PORT || 3001);
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/desktop-session`, { headers: { authorization: String(rawToken || ''), 'x-device-id': process.env.GEWU_DEVICE_ID || '' } });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.code || 'DESKTOP_SESSION_INTROSPECTION_FAILED');
    return data.session;
  },
});
ipcMain.handle('issue-question-draft', (_event, { authorization }) => questionDraftRegistry.issue(authorization));
ipcMain.handle('verify-question-draft-provenance', (_event, { questionId, authorization }) => questionDraftRegistry.verify(questionId, authorization));
ipcMain.handle('runtime-config:get', async () => {
  const config = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
    primaryHostCapable: PRIMARY_HOST_CAPABLE,
  });
  return { ...config, buildFlavor: DESKTOP_BUILD_FLAVOR, primaryHostCapable: PRIMARY_HOST_CAPABLE };
});
ipcMain.handle('desktop-identity:status', async () => getDesktopIdentityVault().status());
ipcMain.handle('desktop-identity:begin-registration', async (_event, input) => {
  return getDesktopIdentityVault().beginRegistration(configuredDesktopIdentity(input));
});
ipcMain.handle('desktop-identity:begin-unified-online-registration', async (_event, input) => {
  return getDesktopIdentityVault().beginUnifiedOnlineRegistration(input);
});
ipcMain.handle('desktop-identity:begin-password-reset', async () => {
  return getDesktopIdentityVault().beginPasswordReset();
});
ipcMain.handle('desktop-identity:complete-registration', async (_event, input) => {
  try {
    return getDesktopIdentityVault().completeRegistration(input);
  } catch (error) {
    // Retain only the stable code locally. The renderer deliberately presents
    // a generic security-safe message and must never receive vault details.
    log(`[desktop-identity:complete-registration] ${String(error?.code || 'DESKTOP_IDENTITY_REGISTRATION_FAILED')}`);
    throw error;
  }
});
ipcMain.handle('desktop-identity:complete-password-reset', async (_event, input) => {
  return getDesktopIdentityVault().completePasswordReset(input);
});
ipcMain.handle('desktop-identity:unlock', async (_event, input) => {
  const unlocked = getDesktopIdentityVault().unlock(input);
  void authorityProjectionWorker?.wake();
  return unlocked;
});
ipcMain.handle('desktop-identity:lock', async () => getDesktopIdentityVault().lock());
ipcMain.handle('desktop-identity:refresh-offline-lease', async (_event, input) => {
  return getDesktopIdentityVault().refreshOfflineLease(input);
});
ipcMain.handle('desktop-identity:sign-challenge', async (_event, input) => {
  return getDesktopIdentityVault().signChallenge(input);
});
ipcMain.handle('desktop-authority:append-draft', async (_event, input) => (
  getDesktopAuthorityRuntime().appendDraft(input)
));
ipcMain.on('desktop-authority:append-draft-sync', (event, input) => {
  try {
    event.returnValue = {
      ok: true,
      item: getDesktopAuthorityRuntime().appendDraftSync(input),
    };
  } catch (error) {
    event.returnValue = {
      ok: false,
      error: { code: error?.code || 'AUTHORITY_DRAFT_APPEND_FAILED' },
    };
  }
});
ipcMain.on('desktop-authority:append-draft-batch-sync', (event, inputs) => {
  try {
    event.returnValue = {
      ok: true,
      items: getDesktopAuthorityRuntime().appendDraftBatchSync(inputs),
    };
  } catch (error) {
    event.returnValue = {
      ok: false,
      error: { code: error?.code || 'AUTHORITY_DRAFT_BATCH_APPEND_FAILED' },
    };
  }
});
ipcMain.handle('desktop-authority:get', async (_event, id) => getDesktopAuthorityRuntime().get(id));
ipcMain.handle('desktop-authority:list', async () => getDesktopAuthorityRuntime().list());
ipcMain.handle('desktop-authority:read-projection', async (_event, input) => (
  typeof primaryHostLocalProjectionReader === 'function'
    ? primaryHostLocalProjectionReader(input)
    : getDesktopAuthorityRuntime().readProjection(input)
));
ipcMain.handle('desktop-authority:submit', async (_event, id, input) => (
  getDesktopAuthorityRuntime().submit(id, input)
));
ipcMain.handle('desktop-authority:confirm-and-submit', async (_event, id, input) => (
  getDesktopAuthorityRuntime().confirmAndSubmit(id, input)
));
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new Error('Invalid external URL');
  }
  return shell.openExternal(url);
});
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { success: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: desktopUpdaterErrorMessage('unavailable', 'check') };
  try {
    log('check-for-updates feed=' + updateFeedUrl + ' version=' + app.getVersion());
    const result = await withOperationTimeout(
      autoUpdater.checkForUpdates(),
      30_000,
      'UPDATE_CHECK_TIMEOUT',
      '\u66f4\u65b0\u68c0\u67e5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5',
    );
    return {
      success: true,
      updateAvailable: result?.isUpdateAvailable === true,
      updateInfo: result?.updateInfo || null,
      feedUrl: updateFeedUrl,
    };
  } catch (err) {
    log('check-for-updates failed: ' + err.message);
    return { success: false, code: err?.code || 'DESKTOP_UPDATE_CHECK_FAILED', error: desktopUpdaterErrorMessage(err, 'check') };
  }
});
ipcMain.handle('download-update', async () => {
  if (!autoUpdater) return { success: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: desktopUpdaterErrorMessage('unavailable', 'download') };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    log('download-update failed: ' + err.message);
    return { success: false, code: err?.code || 'DESKTOP_UPDATE_DOWNLOAD_FAILED', error: desktopUpdaterErrorMessage(err, 'download') };
  }
});
ipcMain.handle('install-update', () => {
  if (!autoUpdater) return { success: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: desktopUpdaterErrorMessage('unavailable', 'install') };
  try {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    log('install-update failed: ' + err.message);
    return { success: false, code: err?.code || 'DESKTOP_UPDATE_INSTALL_FAILED', error: desktopUpdaterErrorMessage(err, 'install') };
  }
});

if (autoUpdater) {
  autoUpdater.on('checking-for-update', () => log('checking-for-update'));
  autoUpdater.on('update-not-available', info => {
    log('update-not-available ' + JSON.stringify(info || {}));
    mainWindow?.webContents.send('update-not-available', info);
  });
  autoUpdater.on('update-available', info => {
    log('update-available ' + JSON.stringify(info || {}));
    mainWindow?.webContents.send('update-available', info);
  });
  autoUpdater.on('update-downloaded', info => {
    log('update-downloaded ' + JSON.stringify(info || {}));
    mainWindow?.webContents.send('update-downloaded', info);
  });
  autoUpdater.on('download-progress', info => mainWindow?.webContents.send('download-progress', info));
  autoUpdater.on('error', err => {
    log('update-error ' + err.message);
    mainWindow?.webContents.send('update-error', desktopUpdaterErrorMessage(err, 'check'));
  });
}
