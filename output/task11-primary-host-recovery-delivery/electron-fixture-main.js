const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, BrowserWindow, ipcMain, Menu } = require('electron');

const projectRoot = path.resolve(process.env.GEWU_FIXTURE_ROOT || path.join(__dirname, '..', '..'));
const userDataPath = path.resolve(process.env.GEWU_FIXTURE_USER_DATA || path.join(__dirname, 'user-data'));
const fixtureNodeRole = process.env.GEWU_FIXTURE_NODE_ROLE === 'primary-host'
  ? 'primary-host'
  : 'desktop-client';
const statePath = path.join(userDataPath, 'fixture-control-state.json');
const now = () => new Date();
const ids = Object.freeze({
  userId: 'fixture-owner-1',
  deviceId: 'fixture-device-1',
  authorizationId: 'fixture-authorization-1',
  sessionId: 'fixture-session-1',
  epochId: 'fixture-epoch-1',
  factorId: 'fixture-factor-1',
  deliveryId: 'fixture-delivery-1',
});

fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-background-networking');

function loadControlState() {
  if (!fs.existsSync(statePath)) return { pending: true, acknowledgementAttempts: 0 };
  return { pending: true, acknowledgementAttempts: 0, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) };
}

let controlState = loadControlState();
let vaultUnlocked = false;
let vaultCredentialVersion = controlState.passwordResetCompleted ? 2 : 1;
let resetChallengePollCount = 0;
let roleSwitchCount = 0;
let server;
let mainWindow;

function saveControlState() {
  fs.writeFileSync(statePath, JSON.stringify(controlState, null, 2));
}

function runtimeConfig(baseUrl) {
  return {
    nodeRole: fixtureNodeRole,
    deviceId: ids.deviceId,
    deviceName: 'Task 11 隔离测试电脑',
    primaryHostEpochId: ids.epochId,
    primaryHostGeneration: 1,
    hostBaseUrl: baseUrl,
    cloudBaseUrl: baseUrl,
    desktopSyncToken: '',
    mainDbPath: '',
    questionBankPath: '',
    questionAssetPath: '',
    questionBankCandidatePaths: [],
    questionBankStoreId: '',
    localCachePath: '',
    nasBackupPath: '',
  };
}

function vaultStatus() {
  const issuedAt = new Date(now().getTime() - 60_000).toISOString();
  const expiresAt = new Date(now().getTime() + 60 * 60 * 1000).toISOString();
  return {
    state: vaultUnlocked ? 'active' : 'sealed',
    unlocked: vaultUnlocked,
    deviceId: ids.deviceId,
    authorizationId: ids.authorizationId,
    credentialVersion: vaultCredentialVersion,
    user: { id: ids.userId, name: 'Task 11 测试管理员' },
    eligibleRoles: ['super_admin', 'teacher'],
    activeRole: 'super_admin',
    teacherId: 'fixture-teacher-1',
    studentId: null,
    offlineLease: {
      issuedAt,
      expiresAt,
      userId: ids.userId,
      deviceId: ids.deviceId,
      authorizationId: ids.authorizationId,
      credentialVersion: vaultCredentialVersion,
      eligibleRoles: ['super_admin', 'teacher'],
      activeRole: 'super_admin',
      teacherId: 'fixture-teacher-1',
      studentId: null,
    },
  };
}

function runtimeStatus(baseUrl) {
  return {
    config: runtimeConfig(baseUrl),
    credential: {
      state: 'active',
      active: true,
      epochId: ids.epochId,
      generation: 1,
      deviceId: ids.deviceId,
      userId: ids.userId,
      activatedAt: '2026-07-19T10:00:00.000Z',
      recoveryDelivery: controlState.pending
        ? { pending: true, deliveryId: ids.deliveryId, epochId: ids.epochId, rowVersion: 1 }
        : { pending: false },
    },
  };
}

function hostControl() {
  return {
    activeEpoch: {
      id: ids.epochId,
      generation: 1,
      deviceId: ids.deviceId,
      userId: ids.userId,
      status: 'active',
      rowVersion: 1,
      activatedAt: '2026-07-19T10:00:00.000Z',
    },
    transfers: [],
    history: [],
    recoveryDeliveryPending: controlState.pending,
    ...(controlState.pending ? {
      pendingRecoveryDelivery: {
        id: ids.deliveryId,
        epochId: ids.epochId,
        factorId: ids.factorId,
        generation: 1,
        status: 'pending',
        rowVersion: 1,
        recipientKeyFingerprint: 'a'.repeat(64),
      },
    } : {}),
  };
}

function sessionPayload(credentialVersion = vaultCredentialVersion, activeRole = 'super_admin') {
  const expiresAt = new Date(now().getTime() + 60 * 60 * 1000).toISOString();
  const lease = { ...vaultStatus().offlineLease, credentialVersion, activeRole };
  return {
    token: 'fixture-session-token',
    session: {
      id: ids.sessionId,
      userId: ids.userId,
      deviceId: ids.deviceId,
      activeRole,
      eligibleRoles: ['super_admin', 'teacher'],
      teacherId: 'fixture-teacher-1',
      studentId: null,
      credentialVersion,
      rowVersion: 1,
      expiresAt,
    },
    profile: {
      id: ids.userId,
      userId: ids.userId,
      name: 'Task 11 测试管理员',
      activeRole,
      eligibleRoles: ['super_admin', 'teacher'],
      teacherId: 'fixture-teacher-1',
      studentId: null,
      user: { id: ids.userId, name: 'Task 11 测试管理员' },
    },
    offlineLease: lease,
  };
}

function deviceRow() {
  return {
    id: 'fixture-device-row-1',
    deviceId: ids.deviceId,
    deviceName: 'Task 11 隔离测试电脑',
    deviceKind: fixtureNodeRole,
    userId: ids.userId,
    keyFingerprint: 'b'.repeat(64),
    status: 'active',
    rowVersion: 1,
    createdAt: '2026-07-19T09:00:00.000Z',
    updatedAt: '2026-07-19T10:00:00.000Z',
    lastSeenAt: '2026-07-19T10:00:00.000Z',
  };
}

function json(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

function routeRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
    });
    res.end();
    return;
  }
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method === 'POST' && pathname === '/api/desktop-identity/challenges/start') {
    resetChallengePollCount = 0;
    json(res, 200, { success: true, data: { challenge: {
      id: 'fixture-password-reset-challenge-1',
      challengeSecret: 'fixture-password-reset-secret',
      shortCode: '654321',
      purpose: 'password_reset',
      status: 'pending_phone',
      rowVersion: 1,
      expiresAt: new Date(now().getTime() + 10 * 60 * 1000).toISOString(),
      qrValue: null,
    } } });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/desktop-identity/challenges/fixture-password-reset-challenge-1') {
    resetChallengePollCount += 1;
    const approved = resetChallengePollCount >= 2;
    json(res, 200, { success: true, data: { challenge: {
      id: 'fixture-password-reset-challenge-1',
      deviceId: ids.deviceId,
      deviceName: 'Task 11 \u9694\u79bb\u6d4b\u8bd5\u7535\u8111',
      keyFingerprint: 'c'.repeat(64),
      purpose: 'password_reset',
      status: approved ? 'approved_pending_exchange' : 'identity_verified_pending_approval',
      rowVersion: approved ? 3 : 2,
      expiresAt: new Date(now().getTime() + 10 * 60 * 1000).toISOString(),
    } } });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/desktop-identity/challenges/fixture-password-reset-challenge-1/exchange') {
    json(res, 200, { success: true, data: {
      ...sessionPayload(2),
      authorization: {
        id: ids.authorizationId,
        deviceId: ids.deviceId,
        deviceName: 'Task 11 \u9694\u79bb\u6d4b\u8bd5\u7535\u8111',
        deviceKind: 'desktop-client',
        userId: ids.userId,
        keyFingerprint: 'c'.repeat(64),
        status: 'active',
        credentialVersion: 2,
        lastPhoneVerifiedAt: now().toISOString(),
        phoneReverifyDueAt: new Date(now().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    } });
    return;
  }
  if (pathname === '/api/desktop-identity/session/challenges/start') {
    json(res, 200, { success: true, data: { challenge: {
      id: 'fixture-session-challenge-1',
      authorizationId: ids.authorizationId,
      credentialVersion: 1,
      nonce: 'fixture-session-nonce',
      nonceIssuedAt: now().toISOString(),
      rowVersion: 1,
    } } });
    return;
  }
  if (pathname === '/api/desktop-identity/session/challenges/fixture-session-challenge-1/exchange') {
    json(res, 200, { success: true, data: sessionPayload() });
    return;
  }
  if (pathname === '/api/desktop-identity/session/role') {
    roleSwitchCount += 1;
    const activeRole = roleSwitchCount % 2 === 1 ? 'teacher' : 'super_admin';
    json(res, 200, { success: true, data: sessionPayload(vaultCredentialVersion, activeRole) });
    return;
  }
  if (pathname === '/api/desktop-identity/devices') {
    json(res, 200, { success: true, data: { items: [deviceRow()] } });
    return;
  }
  if (pathname === '/api/desktop-identity/devices/all') {
    json(res, 200, { success: true, data: { items: [deviceRow()] } });
    return;
  }
  if (pathname === '/api/desktop-identity/authorizations/pending') {
    json(res, 200, { success: true, data: { items: [] } });
    return;
  }
  if (pathname === '/api/desktop-identity/primary-host/status') {
    json(res, 200, { success: true, data: hostControl() });
    return;
  }
  json(res, 200, { success: true, data: { items: [] } });
}

function registerIpc(baseUrl) {
  const config = runtimeConfig(baseUrl);
  ipcMain.handle('runtime-config:get', () => config);
  ipcMain.handle('runtime-config:set', (_event, updates) => ({ ...config, ...(updates || {}) }));
  ipcMain.handle('get-app-version', () => '5.14.4');
  ipcMain.handle('get-user-data-path', () => userDataPath);
  ipcMain.handle('dialog:select-folder', () => '');
  ipcMain.handle('open-external', () => ({ success: true }));
  ipcMain.handle('desktop-identity:status', () => vaultStatus());
  ipcMain.handle('desktop-identity:unlock', (_event, input) => {
    const expectedPassword = controlState.passwordResetCompleted
      ? 'fixture-new-password'
      : 'fixture-password';
    if (input?.password !== expectedPassword) throw new Error('DESKTOP_IDENTITY_PASSWORD_INVALID');
    vaultUnlocked = true;
    return vaultStatus();
  });
  ipcMain.handle('desktop-identity:lock', () => {
    vaultUnlocked = false;
    return vaultStatus();
  });
  ipcMain.handle('desktop-identity:refresh-offline-lease', () => vaultStatus());
  ipcMain.handle('desktop-identity:sign-challenge', () => ({ signature: 'fixture-signature' }));
  ipcMain.handle('desktop-identity:begin-registration', () => { throw new Error('FIXTURE_REGISTRATION_DISABLED'); });
  ipcMain.handle('desktop-identity:begin-password-reset', () => ({
    deviceId: ids.deviceId,
    deviceName: 'Task 11 \u9694\u79bb\u6d4b\u8bd5\u7535\u8111',
    deviceKind: 'desktop-client',
    publicKey: 'FIXTURE-PASSWORD-RESET-PUBLIC-KEY',
    keyFingerprint: 'c'.repeat(64),
  }));
  ipcMain.handle('desktop-identity:complete-registration', () => { throw new Error('FIXTURE_REGISTRATION_DISABLED'); });
  ipcMain.handle('desktop-identity:complete-password-reset', (_event, input) => {
    if (input?.password !== 'fixture-new-password'
      || Number(input?.authorization?.credentialVersion) !== 2) {
      throw new Error('FIXTURE_PASSWORD_RESET_INVALID');
    }
    controlState.passwordResetCompleted = true;
    vaultCredentialVersion = 2;
    vaultUnlocked = true;
    saveControlState();
    return vaultStatus();
  });
  ipcMain.handle('primary-host:status', () => runtimeStatus(baseUrl));
  ipcMain.handle('primary-host:reveal-recovery-package', (_event, input) => {
    if (!controlState.pending || input?.deliveryId !== ids.deliveryId) {
      throw new Error('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH');
    }
    return {
      recoveryPackage: {
        protocolVersion: 1,
        epochId: ids.epochId,
        factorId: ids.factorId,
        deviceId: ids.deviceId,
        generation: 1,
        recoveryCode: 'FIXTURE-RECOVERY-CODE-ONLY-NOT-A-REAL-SECRET-0001',
        createdAt: '2026-07-19T10:00:00.000Z',
      },
    };
  });
  ipcMain.handle('primary-host:acknowledge-recovery-package', (_event, input) => {
    if (!controlState.pending || input?.deliveryId !== ids.deliveryId || Number(input?.expectedRowVersion) !== 1) {
      throw new Error('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT');
    }
    controlState.acknowledgementAttempts += 1;
    if (controlState.acknowledgementAttempts === 1) {
      saveControlState();
      throw new Error('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_NETWORK');
    }
    controlState.pending = false;
    controlState.acknowledgedAt = now().toISOString();
    saveControlState();
    return { state: 'active', active: true, recoveryDelivery: { pending: false }, restartRequired: true };
  });
  ipcMain.handle('primary-host:restart', () => ({ success: true, fixtureRestartDeferred: true }));
  ipcMain.handle('primary-host:adopt', () => { throw new Error('FIXTURE_ADOPTION_DISABLED'); });
  ipcMain.handle('primary-host:demote', () => { throw new Error('FIXTURE_DEMOTION_DISABLED'); });
  ipcMain.handle('primary-host:local-receipt', () => { throw new Error('FIXTURE_RECEIPT_DISABLED'); });
  ipcMain.handle('primary-host:prepare-operation', () => { throw new Error('FIXTURE_OPERATION_DISABLED'); });
  ipcMain.handle('check-for-updates', () => ({
    success: true,
    feedUrl: 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/',
    updateInfo: { version: '5.14.4' },
  }));
  ipcMain.handle('download-update', () => ({ success: false, error: 'FIXTURE_DOWNLOAD_DISABLED' }));
  ipcMain.handle('install-update', () => ({ success: false, error: 'FIXTURE_INSTALL_DISABLED' }));
  ipcMain.handle('issue-question-draft', () => ({ success: false }));
  ipcMain.handle('verify-question-draft-provenance', () => ({ success: false }));
}

app.whenReady().then(() => new Promise((resolve, reject) => {
  server = http.createServer(routeRequest);
  server.once('error', reject);
  server.listen(3001, '127.0.0.1', () => resolve(server.address()));
})).then(address => {
  const baseUrl = `http://127.0.0.1:${address.port}`;
  registerIpc(baseUrl);
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    autoHideMenuBar: true,
    show: true,
    title: '格物工坊 Task 11 隔离验证',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(projectRoot, 'public', 'preload.js'),
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  return mainWindow.loadFile(path.join(projectRoot, 'build', 'index.html'));
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});

app.on('before-quit', () => {
  if (server) server.close();
});

app.on('window-all-closed', () => app.quit());
