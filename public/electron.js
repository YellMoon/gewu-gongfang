const { app, BrowserWindow, Menu, ipcMain, screen, shell, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const { acquireDesktopSingleInstance } = require('./electronSingleInstance');
const { createCrossInstallInstanceLock } = require('./electronCrossInstallLock');
const { QuestionDraftProvenanceRegistry } = require('./questionDraftProvenanceRegistry');
const { sealQuestionImportSource } = require('./questionImportRelay');
const { ensureRuntimeConfig, applyRuntimeConfigToEnv, MANAGED_CLOUD_BASE_URL } = require('./runtimeConfig');
const { createDesktopIdentityVault } = require('./desktopIdentityVault');
const { createDesktopAuthorityRuntime } = require('./desktopAuthorityRuntime');
const { resolveDesktopBuildFlavor, updateFeedForFlavor, validateDesktopCapabilityManifest } = require('./desktopBuildFlavor');
const { withOperationTimeout } = require('./updateCheckTimeout');
const { buildApplicationMenu, desktopUpdaterErrorMessage, desktopWindowChrome } = require('./electronShellPolicy');
const { ensureLocalSessionSigningSecret } = require('./localSessionSigningSecret');

let mainWindow;
let backendServer = null;
let desktopIdentityVault = null;
let desktopAuthorityRuntime = null;
let autoUpdater = null;

const singleInstanceOwner = acquireDesktopSingleInstance({ app, getWindow: () => mainWindow });
function activateMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
const crossInstallInstanceLock = singleInstanceOwner
  ? createCrossInstallInstanceLock({ app, userDataPath: app.getPath('userData'), activateWindow: activateMainWindow })
  : null;

const desktopPackage = require('../package.json');
const DESKTOP_BUILD_FLAVOR = resolveDesktopBuildFlavor({ isPackaged: app.isPackaged, metadata: desktopPackage, env: process.env });
validateDesktopCapabilityManifest({ metadata: desktopPackage, runtimeFlavor: DESKTOP_BUILD_FLAVOR });
process.env.GEWU_DESKTOP_BUILD_FLAVOR = DESKTOP_BUILD_FLAVOR;
const updateFeedUrl = updateFeedForFlavor(DESKTOP_BUILD_FLAVOR, process.env);
const electronLocalBridgeSecret = crypto.randomBytes(32).toString('base64url');
process.env.GEWU_ELECTRON_LOCAL_BRIDGE_SECRET = electronLocalBridgeSecret;

try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl });
} catch (_error) {}

const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'electron-main.log');
function log(message) {
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`); } catch (_error) {}
}
process.on('uncaughtException', error => log(`UNCAUGHT ${String(error?.message || error)}`));
process.on('unhandledRejection', error => log(`UNHANDLED_REJECTION ${String(error?.message || error)}`));

function runtimeConfigPath() {
  return path.join(app.getPath('userData'), 'gewugongfang.config.json');
}

function loadRuntimeConfig() {
  const config = ensureRuntimeConfig(runtimeConfigPath(), { userDataPath: app.getPath('userData') });
  applyRuntimeConfigToEnv(config, process.env);
  return config;
}

function getDesktopIdentityVault() {
  if (!desktopIdentityVault) {
    desktopIdentityVault = createDesktopIdentityVault({
      filePath: path.join(app.getPath('userData'), 'desktop-identity-v2.bin'),
      legacyFilePath: path.join(app.getPath('userData'), 'desktop-session.bin'),
      safeStorage,
    });
  }
  return desktopIdentityVault;
}

function configuredDesktopIdentity(input = {}) {
  const config = loadRuntimeConfig();
  const deviceId = String(process.env.GEWU_DEVICE_ID || config.deviceId || '').trim();
  if (!deviceId) {
    const error = new Error('DESKTOP_IDENTITY_DEVICE_ID_REQUIRED');
    error.code = 'DESKTOP_IDENTITY_DEVICE_ID_REQUIRED';
    throw error;
  }
  return {
    deviceId,
    deviceName: String(input.deviceName || config.deviceName || require('os').hostname()).trim().slice(0, 128),
    deviceKind: 'desktop-client',
  };
}

function getDesktopAuthorityRuntime() {
  if (!desktopAuthorityRuntime) {
    const config = loadRuntimeConfig();
    desktopAuthorityRuntime = createDesktopAuthorityRuntime({
      filePath: path.join(app.getPath('userData'), 'desktop-authority-outbox.bin'),
      safeStorage,
      vault: getDesktopIdentityVault(),
      durableRelayBaseUrl: String(config.cloudBaseUrl || MANAGED_CLOUD_BASE_URL),
      relayWebSocketBaseUrl: String(config.cloudBaseUrl || MANAGED_CLOUD_BASE_URL),
      WebSocketImpl: WebSocket,
      isOnline: () => net.isOnline(),
    });
  }
  return desktopAuthorityRuntime;
}

function findBackendApp() {
  const candidates = [
    path.join(process.resourcesPath || '', 'backend', 'src', 'app.js'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'backend', 'src', 'app.js'),
    path.join(app.getAppPath(), 'backend', 'src', 'app.js'),
    path.join(__dirname, '..', 'backend', 'src', 'app.js'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function startBackendService() {
  if (process.env.DISABLE_EMBEDDED_BACKEND === '1') return;
  const backendAppPath = findBackendApp();
  if (!backendAppPath) return;
  try {
    const config = loadRuntimeConfig();
    ensureLocalSessionSigningSecret(process.env, electronLocalBridgeSecret);
    const port = Number(process.env.PORT || 3001);
    process.env.PORT = String(port);
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    const appDataDir = app.getPath('userData');
    process.env.GEWU_DATA_DIR = process.env.GEWU_DATA_DIR || appDataDir;
    process.env.DB_PATH = process.env.DB_PATH || path.join(appDataDir, 'cache', 'scheduling.db');
    process.env.QUESTION_BANK_UPLOAD_DIR = process.env.QUESTION_BANK_UPLOAD_DIR || path.join(appDataDir, 'cache', 'question-bank');
    const nodePath = path.join(app.getAppPath(), 'node_modules');
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}${path.delimiter}${nodePath}` : nodePath;
    require('module').Module._initPaths();
    const { createApp } = require(backendAppPath);
    backendServer = createApp().listen(port, '127.0.0.1', () => log(`Embedded cache service listening on 127.0.0.1:${port} device=${config.deviceId}`));
    backendServer.on('error', error => log(`Embedded cache service failed ${String(error?.message || error)}`));
  } catch (error) {
    log(`Embedded cache service start failed ${String(error?.message || error)}`);
  }
}

function createWindow() {
  const chrome = desktopWindowChrome();
  Menu.setApplicationMenu(buildApplicationMenu({ isPackaged: app.isPackaged, menuApi: Menu }));
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: workArea.width,
    height: workArea.height,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#ffffff',
    show: false,
    title: '\u683c\u7269\u5de5\u574a',
    autoHideMenuBar: chrome.autoHideMenuBar,
    menuBarVisible: chrome.menuBarVisible,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--gewu-desktop-build-flavor=${DESKTOP_BUILD_FLAVOR}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      enableRemoteModule: false,
      webSecurity: true,
    },
  });
  mainWindow.maximize();
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
    mainWindow.show();
  } else {
    const candidates = [
      path.join(__dirname, '..', 'build', 'index.html'),
      path.join(__dirname, 'build', 'index.html'),
      path.join(process.resourcesPath, 'app.asar', 'build', 'index.html'),
      path.join(path.dirname(process.execPath), 'build', 'index.html'),
      path.join(__dirname, 'index.html'),
    ];
    const indexPath = candidates.find(candidate => fs.existsSync(candidate));
    if (!indexPath) return showErrorPage('\u627e\u4e0d\u5230\u5e94\u7528\u6587\u4ef6');
    mainWindow.loadFile(indexPath).then(() => mainWindow?.show()).catch(error => showErrorPage(String(error?.message || error)));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function showErrorPage(message) {
  if (!mainWindow) return;
  mainWindow.loadURL(`data:text/html,${encodeURIComponent(`<meta charset="UTF-8"><main style="font-family:sans-serif;padding:48px"><h2>${message}</h2><p>\u65e5\u5fd7\u4f4d\u7f6e\uff1a${logFile}</p></main>`)}`);
  mainWindow.show();
}

function stopServices() {
  try { desktopIdentityVault?.lock(); } catch (_error) {}
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
}

if (singleInstanceOwner) {
  Promise.all([app.whenReady(), crossInstallInstanceLock.ready]).then(([, owner]) => {
    if (!owner) return;
    startBackendService();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { log(`INSTANCE_LOCK_FAILED ${String(error?.message || error)}`); app.quit(); });
}
app.on('window-all-closed', () => { stopServices(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { void crossInstallInstanceLock?.close(); stopServices(); });

const questionDraftRegistry = new QuestionDraftProvenanceRegistry({
  filePath: path.join(app.getPath('userData'), 'question-draft-provenance.json'),
  tokenVerifier: async authorization => {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3001}/api/auth/desktop-session`, {
      headers: { authorization: String(authorization || ''), 'x-device-id': process.env.GEWU_DEVICE_ID || '' },
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.code || 'DESKTOP_SESSION_INTROSPECTION_FAILED');
    return data.session;
  },
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-user-data-path', () => app.getPath('userData'));
ipcMain.handle('runtime-config:get', () => ({ ...loadRuntimeConfig(), buildFlavor: DESKTOP_BUILD_FLAVOR }));
ipcMain.handle('desktop-identity:status', () => getDesktopIdentityVault().status());
ipcMain.handle('desktop-identity:begin-registration', (_event, input) => getDesktopIdentityVault().beginRegistration(configuredDesktopIdentity(input)));
ipcMain.handle('desktop-identity:begin-unified-online-registration', (_event, input) => getDesktopIdentityVault().beginUnifiedOnlineRegistration(input));
ipcMain.handle('desktop-identity:begin-password-reset', () => getDesktopIdentityVault().beginPasswordReset());
ipcMain.handle('desktop-identity:complete-registration', (_event, input) => getDesktopIdentityVault().completeRegistration(input));
ipcMain.handle('desktop-identity:complete-password-reset', (_event, input) => getDesktopIdentityVault().completePasswordReset(input));
ipcMain.handle('desktop-identity:unlock', (_event, input) => getDesktopIdentityVault().unlock(input));
ipcMain.handle('desktop-identity:lock', () => getDesktopIdentityVault().lock());
ipcMain.handle('desktop-identity:refresh-offline-lease', (_event, input) => getDesktopIdentityVault().refreshOfflineLease(input));
ipcMain.handle('desktop-identity:sign-challenge', (_event, input) => getDesktopIdentityVault().signChallenge(input));
ipcMain.handle('desktop-authority:append-draft', (_event, input) => getDesktopAuthorityRuntime().appendDraft(input));
ipcMain.on('desktop-authority:append-draft-sync', (event, input) => {
  try { event.returnValue = { ok: true, item: getDesktopAuthorityRuntime().appendDraftSync(input) }; }
  catch (error) { event.returnValue = { ok: false, error: { code: error?.code || 'AUTHORITY_DRAFT_APPEND_FAILED' } }; }
});
ipcMain.on('desktop-authority:append-draft-batch-sync', (event, inputs) => {
  try { event.returnValue = { ok: true, items: getDesktopAuthorityRuntime().appendDraftBatchSync(inputs) }; }
  catch (error) { event.returnValue = { ok: false, error: { code: error?.code || 'AUTHORITY_DRAFT_BATCH_APPEND_FAILED' } }; }
});
ipcMain.handle('desktop-authority:get', (_event, id) => getDesktopAuthorityRuntime().get(id));
ipcMain.handle('desktop-authority:list', () => getDesktopAuthorityRuntime().list());
ipcMain.handle('desktop-authority:read-projection', (_event, input) => getDesktopAuthorityRuntime().readProjection(input));
ipcMain.handle('desktop-authority:submit', (_event, id, input) => getDesktopAuthorityRuntime().submit(id, input));
ipcMain.handle('desktop-authority:confirm-and-submit', (_event, id, input) => getDesktopAuthorityRuntime().confirmAndSubmit(id, input));
ipcMain.handle('issue-question-draft', (_event, { authorization }) => questionDraftRegistry.issue(authorization));
ipcMain.handle('verify-question-draft-provenance', (_event, { questionId, authorization }) => questionDraftRegistry.verify(questionId, authorization));
ipcMain.handle('seal-question-import-source', (_event, input) => sealQuestionImportSource(input));
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('INVALID_EXTERNAL_URL');
  return shell.openExternal(url);
});

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { success: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: desktopUpdaterErrorMessage('unavailable', 'check') };
  try {
    const result = await withOperationTimeout(autoUpdater.checkForUpdates(), 30000, 'UPDATE_CHECK_TIMEOUT', 'UPDATE_CHECK_TIMEOUT');
    return { success: true, updateAvailable: result?.isUpdateAvailable === true, updateInfo: result?.updateInfo || null, feedUrl: updateFeedUrl };
  } catch (error) {
    return { success: false, code: error?.code || 'DESKTOP_UPDATE_CHECK_FAILED', error: desktopUpdaterErrorMessage(error, 'check') };
  }
});
ipcMain.handle('download-update', async () => {
  if (!autoUpdater) return { success: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: desktopUpdaterErrorMessage('unavailable', 'download') };
  try { await autoUpdater.downloadUpdate(); return { success: true }; }
  catch (error) { return { success: false, code: error?.code || 'DESKTOP_UPDATE_DOWNLOAD_FAILED', error: desktopUpdaterErrorMessage(error, 'download') }; }
});
ipcMain.handle('install-update', () => {
  if (!autoUpdater) return { success: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: desktopUpdaterErrorMessage('unavailable', 'install') };
  try { autoUpdater.quitAndInstall(false, true); return { success: true }; }
  catch (error) { return { success: false, code: error?.code || 'DESKTOP_UPDATE_INSTALL_FAILED', error: desktopUpdaterErrorMessage(error, 'install') }; }
});
if (autoUpdater) {
  autoUpdater.on('update-not-available', info => mainWindow?.webContents.send('update-not-available', info));
  autoUpdater.on('update-available', info => mainWindow?.webContents.send('update-available', info));
  autoUpdater.on('update-downloaded', info => mainWindow?.webContents.send('update-downloaded', info));
  autoUpdater.on('download-progress', info => mainWindow?.webContents.send('download-progress', info));
  autoUpdater.on('error', error => mainWindow?.webContents.send('update-error', desktopUpdaterErrorMessage(error, 'check')));
}
