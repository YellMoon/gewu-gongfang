const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { QuestionDraftProvenanceRegistry } = require('./questionDraftProvenanceRegistry');
const fs = require('fs');
const {
  readRuntimeConfig,
  ensureRuntimeConfig,
  writeRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  applyRuntimeConfigToEnv,
  MANAGED_CLOUD_BASE_URL,
} = require('./runtimeConfig');
const { buildLanHostUrls } = require('./lanDiscovery');
const { createDesktopIdentityVault } = require('./desktopIdentityVault');
const {
  PRIMARY_HOST_FLAVOR,
  resolveDesktopBuildFlavor,
  updateFeedForFlavor,
} = require('./desktopBuildFlavor');
const desktopPackage = require('../package.json');
const DESKTOP_BUILD_FLAVOR = resolveDesktopBuildFlavor({
  isPackaged: app.isPackaged,
  metadata: desktopPackage,
  env: process.env,
});
process.env.GEWU_DESKTOP_BUILD_FLAVOR = DESKTOP_BUILD_FLAVOR;
const PRIMARY_HOST_CAPABLE = DESKTOP_BUILD_FLAVOR === PRIMARY_HOST_FLAVOR;
let createPrimaryHostCredentialStore;
let buildPrimaryHostOperationManifest;
let createPrimaryHostRuntimeManager;
let generateRecoveryDeliveryKeyPair;
let openRecoveryPackage;
let signRecoveryDeliveryAcknowledgement;
if (PRIMARY_HOST_CAPABLE) {
  ({ createPrimaryHostCredentialStore } = require('./primaryHostCredentialStore'));
  ({ buildPrimaryHostOperationManifest } = require('./primaryHostOperationValidation'));
  ({ createPrimaryHostRuntimeManager } = require('./primaryHostRuntimeManager'));
  ({
    generateRecoveryDeliveryKeyPair,
    openRecoveryPackage,
    signRecoveryDeliveryAcknowledgement,
  } = require('../backend/src/services/primaryHostRecoveryDeliveryProtocol'));
}
const { withOperationTimeout } = require('./updateCheckTimeout');
const { buildApplicationMenu, desktopUpdaterErrorMessage, desktopWindowChrome } = require('./electronShellPolicy');
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

let mainWindow;
let backendServer = null;
let desktopIdentityVault = null;
let primaryHostRuntimeManager = null;

function getRuntimeConfigPath() {
  return path.join(app.getPath('userData'), 'gewugongfang.config.json');
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

async function localDesktopIdentityRequest(pathname, { method = 'GET', body } = {}) {
  const port = Number(process.env.PORT || 3001);
  const headers = {
    Accept: 'application/json',
    'x-gewu-electron-local-bridge': electronLocalBridgeSecret,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`http://127.0.0.1:${port}/api/desktop-identity${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }
  if (!response.ok || !payload?.success) {
    const error = new Error(payload?.code || 'DESKTOP_SINGLE_USER_LOCAL_REQUEST_FAILED');
    error.code = payload?.code || 'DESKTOP_SINGLE_USER_LOCAL_REQUEST_FAILED';
    throw error;
  }
  return payload;
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
  const response = await fetch(`${MANAGED_CLOUD_BASE_URL}/api/desktop-identity/primary-host/credentials/verify`, {
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
    signal: AbortSignal.timeout(15000),
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
  const response = await fetch(
    `${MANAGED_CLOUD_BASE_URL}/api/desktop-identity/primary-host/recovery-deliveries/${encodeURIComponent(deliveryId)}/acknowledge`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify({ ...acknowledgementBody, signature: input.signature }),
      signal: AbortSignal.timeout(15000),
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
    writeManagedHostRuntimeConfig,
    writeManagedClientRuntimeConfig,
    applyRuntimeConfigToEnv,
    verifyAdoption: verifyPrimaryHostAdoption,
    acknowledgeDelivery: acknowledgePrimaryHostRecoveryDelivery,
    generateRecoveryDeliveryKeyPair,
    openRecoveryPackage,
    signRecoveryDeliveryAcknowledgement,
  });
  return primaryHostRuntimeManager;
}

async function readPrimaryHostControlStatus(authorization) {
  const normalizedAuthorization = String(authorization || '').trim();
  if (!normalizedAuthorization.startsWith('Bearer ') || normalizedAuthorization.length > 16384) {
    const error = new Error('PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED');
    error.code = 'PRIMARY_HOST_CONTROL_AUTHORIZATION_REQUIRED';
    throw error;
  }
  const response = await fetch(`${MANAGED_CLOUD_BASE_URL}/api/desktop-identity/primary-host/status`, {
    headers: { Accept: 'application/json', Authorization: normalizedAuthorization },
    signal: AbortSignal.timeout(15000),
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
  });
  const credentialStage = Object.freeze({
    id: stagedCredential.stageId,
    deviceId: stagedCredential.deviceId,
    targetGeneration: stagedCredential.generation,
    commitment: stagedCredential.credentialCommitment,
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
  const proofResponse = await fetch(
    `${MANAGED_CLOUD_BASE_URL}/api/desktop-identity/primary-host/preflight-proofs`,
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
      signal: AbortSignal.timeout(15000),
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

function configuredDesktopIdentity(input = {}) {
  const runtimeConfig = ensureRuntimeConfig(getRuntimeConfigPath(), {
    userDataPath: app.getPath('userData'),
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
    deviceKind: PRIMARY_HOST_CAPABLE && runtimeConfig.nodeRole === 'primary-host' ? 'primary-host' : 'desktop-client',
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
    log('Runtime config loaded: role=' + runtimeConfig.nodeRole + ' device=' + runtimeConfig.deviceId);
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    process.env.PORT = process.env.PORT || '3001';
    if (runtimeConfig.nodeRole === 'primary-host') {
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
    const listenHost = runtimeConfig.nodeRole === 'primary-host' ? '0.0.0.0' : '127.0.0.1';
    backendServer = backendApp.listen(Number(process.env.PORT), listenHost, () => {
      log(`Embedded backend listening on ${listenHost}:${process.env.PORT}`);
    });
    backendServer.on('error', err => log('Embedded backend error: ' + err.message));
  } catch (err) {
    log('Embedded backend start failed: ' + err.message + '\n' + err.stack);
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
  const html = `<html><body style="font-family:sans-serif;padding:50px;background:#fff">
    <h2>⚠️ ${msg}</h2>
    <p>请尝试用命令行启动查看详细日志：</p>
    <code>"${process.execPath}"</code>
    <p>日志位置：${logFile}</p>
  </body></html>`;
  mainWindow.loadURL('data:text/html,' + encodeURIComponent(html));
  mainWindow.show();
}

app.whenReady().then(() => {
  log('whenReady');
  startBackendService();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  lockDesktopIdentityVault();
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  lockDesktopIdentityVault();
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
  const config = ensureRuntimeConfig(getRuntimeConfigPath(), { userDataPath: app.getPath('userData') });
  return { ...config, buildFlavor: DESKTOP_BUILD_FLAVOR, primaryHostCapable: PRIMARY_HOST_CAPABLE };
});
ipcMain.handle('runtime-config:set', async (_event, config) => {
  const saved = writeRuntimeConfig(getRuntimeConfigPath(), config, { userDataPath: app.getPath('userData') });
  return { ...saved, buildFlavor: DESKTOP_BUILD_FLAVOR, primaryHostCapable: PRIMARY_HOST_CAPABLE };
});
if (PRIMARY_HOST_CAPABLE) {
  ipcMain.handle('primary-host:status', async () => getPrimaryHostRuntimeManager().status());
  ipcMain.handle('primary-host:adopt', async (_event, input) => getPrimaryHostRuntimeManager().adopt(input));
  ipcMain.handle('primary-host:demote', async (_event, input) => getPrimaryHostRuntimeManager().demote(input));
  ipcMain.handle('primary-host:local-receipt', async (_event, input) => issuePrimaryHostLocalReceipt(input));
  ipcMain.handle('primary-host:prepare-operation', async (_event, input) => preparePrimaryHostOperation(input));
  ipcMain.handle('primary-host:reveal-recovery-package', async (_event, input) => (
    getPrimaryHostRuntimeManager().revealRecoveryPackage(input)
  ));
  ipcMain.handle('primary-host:acknowledge-recovery-package', async (_event, input) => (
    getPrimaryHostRuntimeManager().acknowledgeRecoveryPackage(input)
  ));
  ipcMain.handle('primary-host:restart', async () => {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
    return true;
  });
  ipcMain.handle('single-user:enable-mode', async (_event, input) => (
    getPrimaryHostRuntimeManager().setIdentityMode({
      mode: 'single-user',
      confirmation: input?.confirmation,
    })
  ));
  ipcMain.handle('single-user:disable-mode', async (_event, input) => {
    const disabled = await localDesktopIdentityRequest('/single-user/disable', {
      method: 'POST',
      body: {},
    });
    const runtime = getPrimaryHostRuntimeManager().setIdentityMode({
      mode: 'full',
      confirmation: input?.confirmation,
    });
    return Object.freeze({ disabled, runtime });
  });
  ipcMain.handle('single-user:status', async () => {
    const runtime = getPrimaryHostRuntimeManager().status();
    if (runtime?.config?.desktopIdentityMode !== 'single-user') {
      return Object.freeze({ mode: runtime?.config?.desktopIdentityMode || 'full', runtime });
    }
    const local = await localDesktopIdentityRequest('/single-user/status');
    return Object.freeze({ ...local, runtime });
  });
  ipcMain.handle('single-user:bootstrap', async (_event, input = {}) => {
    if (Object.hasOwn(input, 'password')) {
      const error = new Error('DESKTOP_SINGLE_USER_PASSWORD_FORBIDDEN');
      error.code = 'DESKTOP_SINGLE_USER_PASSWORD_FORBIDDEN';
      throw error;
    }
    return localDesktopIdentityRequest('/single-user/bootstrap', {
      method: 'POST',
      body: {
        publicIdentity: input.publicIdentity,
        confirmation: input.confirmation,
        operationManifest: input.operationManifest,
      },
    });
  });
  ipcMain.handle('single-user:reset-host-password', async (_event, input = {}) => {
    if (Object.hasOwn(input, 'password')) {
      const error = new Error('DESKTOP_SINGLE_USER_PASSWORD_FORBIDDEN');
      error.code = 'DESKTOP_SINGLE_USER_PASSWORD_FORBIDDEN';
      throw error;
    }
    return localDesktopIdentityRequest('/single-user/reset-host-password', {
      method: 'POST',
      body: {
        publicIdentity: input.publicIdentity,
        confirmation: input.confirmation,
        expectedCredentialVersion: input.expectedCredentialVersion,
      },
    });
  });
  ipcMain.handle('single-user:issue-pairing-code', async () => (
    localDesktopIdentityRequest('/single-user/grants', { method: 'POST', body: {} })
  ));
  ipcMain.handle('single-user:revoke-pairing-code', async (_event, input = {}) => (
    localDesktopIdentityRequest(
      `/single-user/grants/${encodeURIComponent(String(input.grantId || ''))}/revoke`,
      { method: 'POST', body: {} }
    )
  ));
}
ipcMain.handle('desktop-identity:status', async () => getDesktopIdentityVault().status());
ipcMain.handle('desktop-identity:begin-registration', async (_event, input) => {
  return getDesktopIdentityVault().beginRegistration(configuredDesktopIdentity(input));
});
ipcMain.handle('desktop-identity:begin-single-user-enrollment', async (_event, input) => {
  return getDesktopIdentityVault().beginSingleUserEnrollment(configuredDesktopIdentity(input));
});
ipcMain.handle('desktop-identity:create-pairing-envelope', async (_event, input) => {
  return getDesktopIdentityVault().createPairingEnvelope(input);
});
ipcMain.handle('desktop-identity:begin-password-reset', async () => {
  return getDesktopIdentityVault().beginPasswordReset();
});
ipcMain.handle('desktop-identity:complete-registration', async (_event, input) => {
  return getDesktopIdentityVault().completeRegistration(input);
});
ipcMain.handle('desktop-identity:complete-password-reset', async (_event, input) => {
  return getDesktopIdentityVault().completePasswordReset(input);
});
ipcMain.handle('desktop-identity:unlock', async (_event, input) => {
  return getDesktopIdentityVault().unlock(input);
});
ipcMain.handle('desktop-identity:lock', async () => getDesktopIdentityVault().lock());
ipcMain.handle('desktop-identity:refresh-offline-lease', async (_event, input) => {
  return getDesktopIdentityVault().refreshOfflineLease(input);
});
ipcMain.handle('desktop-identity:sign-challenge', async (_event, input) => {
  return getDesktopIdentityVault().signChallenge(input);
});
ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? '' : result.filePaths[0];
});
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
