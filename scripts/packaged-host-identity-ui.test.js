'use strict';

// Real packaged-Electron regression check for the host identity unlock path.
// It uses only a newly-created disposable profile and a synthetic test password.
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { DatabaseService } = require('../backend/src/database');
const {
  bindQuestionBankStoreToDatabase,
  initQuestionBankStore,
} = require('../backend/src/services/questionBankStorageService');
const { CANONICAL_SUPER_ADMIN_ID } = require('../backend/src/services/authorizationPolicy');
const { buildIsolatedHostIdentityConfig } = require('./hostIdentityUiProfile');

const TEST_PASSWORD = 'SyntheticHostUiPassword-2026';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-real-desktop-host-ui-'));
const EXE_PATH = path.resolve(process.env.GEWU_PACKAGED_HOST_EXE || '');
const HOST_STARTUP_TIMEOUT_MS = Math.max(30_000, Number(process.env.GEWU_PACKAGED_HOST_STARTUP_TIMEOUT_MS || 120_000));

function assertDisposableRoot(root) {
  assert(path.basename(root).startsWith('tmp-real-desktop-host-ui-'), 'DISPOSABLE_PROFILE_REQUIRED');
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(check, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${description}${lastError ? `: ${lastError.message}` : ''}`);
}

function prepareProfile({ backendPort }) {
  assertDisposableRoot(ROOT);
  const dbPath = path.join(ROOT, 'data', 'scheduling.db');
  const configPath = path.join(ROOT, 'gewugongfang.config.json');
  const deviceId = 'real_e2e_packaged_host_ui';
  const config = {
    ...buildIsolatedHostIdentityConfig({ root: ROOT, backendPort, deviceId }),
    deviceId,
    primaryHostEpochId: '',
    primaryHostGeneration: null,
    cloudBaseUrl: 'https://physicsedu.xyz/scheduling',
    desktopSyncToken: '',
    questionBankPath: '',
    questionAssetPath: '',
    questionBankCandidatePaths: [],
    questionBankStoreId: '',
    nasBackupPath: '',
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = dbPath;
  const service = new DatabaseService();
  const db = service.db;
  try {
    const owner = db.prepare('SELECT id FROM users WHERE id=? AND deleted=0').get(CANONICAL_SUPER_ADMIN_ID);
    assert(owner, 'TEST_CANONICAL_OWNER_REQUIRED');
    const questionBankPath = path.join(ROOT, 'question-bank');
    const manifest = initQuestionBankStore(questionBankPath, { deviceId });
    const binding = bindQuestionBankStoreToDatabase({
      db,
      root: questionBankPath,
      authz: {
        role: 'super_admin', userId: owner.id, deviceTrusted: true, deviceActive: true,
        deviceOwnerUserId: owner.id, userApproved: true, isPrimaryHost: true,
      },
      runtime: {
        nodeRole: 'primary-host', clientType: 'desktop', tokenUse: 'desktop-session',
        deviceId, tokenDeviceId: deviceId,
      },
    });
    fs.writeFileSync(configPath, JSON.stringify({
      ...config,
      questionBankPath,
      questionAssetPath: path.join(questionBankPath, 'assets'),
      questionBankCandidatePaths: [questionBankPath],
      questionBankStoreId: binding.storeId || manifest.storeId,
    }, null, 2), 'utf8');
  } finally {
    service.close();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
  }
  return { dbPath, configPath };
}

async function connectToApp(cdpPort) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await waitFor(() => browser.contexts()
    .flatMap(context => context.pages())
    .find(candidate => !candidate.isClosed()), 'ELECTRON_RENDERER_NOT_READY');
  return { browser, page };
}

async function stopDisposableApp(root, child) {
  assertDisposableRoot(root);
  const pids = new Set();
  if (child?.pid) pids.add(child.pid);
  const escapedMarker = `--user-data-dir=${root}`.replace(/'/g, "''");
  try {
    const output = childProcess.execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escapedMarker}*' } | Select-Object -ExpandProperty ProcessId`,
    ], { encoding: 'utf8', windowsHide: true });
    for (const value of output.split(/\s+/)) {
      if (/^\d+$/.test(value)) pids.add(Number(value));
    }
  } catch (_error) { /* the direct child PID below is still safe to stop */ }
  for (const pid of pids) {
    try { childProcess.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_error) { /* already stopped */ }
  }
}

async function main() {
  assert(EXE_PATH && fs.existsSync(EXE_PATH), 'GEWU_PACKAGED_HOST_EXE_REQUIRED');
  assert.strictEqual(path.basename(EXE_PATH), '格物工坊.exe', 'PRIMARY_HOST_EXE_REQUIRED');
  const backendPort = await freePort();
  const cdpPort = await freePort();
  const { dbPath } = prepareProfile({ backendPort });
  const consoleErrors = [];
  const child = childProcess.spawn(EXE_PATH, [
    `--user-data-dir=${ROOT}`,
    `--remote-debugging-port=${cdpPort}`,
  ], {
    cwd: path.dirname(EXE_PATH),
    detached: false,
    windowsHide: true,
    env: { ...process.env, PORT: String(backendPort) },
    stdio: 'ignore',
  });

  let first = null;
  let second = null;
  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`);
      return response.ok;
    }, 'HOST_BACKEND_NOT_HEALTHY', HOST_STARTUP_TIMEOUT_MS);
    first = await connectToApp(cdpPort);
    first.page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await first.page.getByPlaceholder('设置本机密码（至少 6 个字符）').fill(TEST_PASSWORD);
    await first.page.getByPlaceholder('再次输入本机密码').fill(TEST_PASSWORD);
    await first.page.getByRole('button', { name: '备份并完成初始化' }).click();

    await waitFor(() => fs.existsSync(path.join(ROOT, 'desktop-identity-v2.bin')), 'HOST_IDENTITY_VAULT_NOT_CREATED');
    first = null;

    second = await waitFor(async () => {
      try { return await connectToApp(cdpPort); } catch (_error) { return null; }
    }, 'HOST_RELAUNCH_NOT_READY', 45_000);
    second.page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const identityResponses = [];
    second.page.on('response', async response => {
      if (!response.url().includes('/api/desktop-identity/')) return;
      try {
        const payload = await response.json();
        identityResponses.push({ url: response.url(), status: response.status(), code: payload?.code || null });
      } catch (_error) { /* diagnostics only */ }
    });
    await second.page.getByPlaceholder('请输入本机密码').fill(TEST_PASSWORD);
    await second.page.getByRole('button', { name: '验证并进入' }).click();
    try {
      await second.page.getByRole('button', { name: '锁定' }).waitFor({ timeout: 30_000 });
    } catch (error) {
      console.error(`post-unlock body: ${JSON.stringify(await second.page.locator('body').innerText())}`);
      console.error(`post-unlock identity responses: ${JSON.stringify(identityResponses)}`);
      console.error(`post-unlock renderer errors: ${JSON.stringify(consoleErrors)}`);
      throw error;
    }

    assert.strictEqual(
      identityResponses.length,
      0,
      `a locally bootstrapped host unlock must not wait for an identity HTTP session: ${JSON.stringify(identityResponses)}`
    );

    const db = require('better-sqlite3')(dbPath, { readonly: true });
    try {
      assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM primary_host_epochs WHERE status='active'").get().count, 1);
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM desktop_device_authorizations').get().count, 1);
    } finally {
      db.close();
    }
    assert.strictEqual(consoleErrors.some(message => /Content Security Policy|violates the following Content Security Policy/i.test(message)), false,
      'packaged host must allow its configured loopback API port');
    console.log('packaged host identity UI check passed');
  } finally {
    await first?.browser?.close().catch(() => {});
    await second?.browser?.close().catch(() => {});
    if (process.env.GEWU_KEEP_PACKAGED_HOST_UI_PROFILE !== '1') {
      await stopDisposableApp(ROOT, child);
    }
    // ROOT is asserted above to be a per-run temporary profile, never a user profile.
    if (process.env.GEWU_KEEP_PACKAGED_HOST_UI_PROFILE !== '1') {
      try {
        fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
      } catch (cleanupError) {
        console.error(`disposable profile cleanup failed: ${cleanupError.message}`);
      }
    } else {
      console.log(`preserved disposable profile: ${ROOT}`);
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
