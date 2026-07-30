'use strict';

// Real packaged-desktop acceptance harness. It deliberately drives rendered
// Electron windows through CDP and does not call any host task processing URL.
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { DatabaseService } = require('../backend/src/database');
const { bindQuestionBankStoreToDatabase, initQuestionBankStore } = require('../backend/src/services/questionBankStorageService');
const { CANONICAL_SUPER_ADMIN_ID } = require('../backend/src/services/authorizationPolicy');
const { connectRealDesktopPage } = require('./realDesktopCdp');
const {
  acquireRunLease,
  assertPackagedDesktopProcessBudget,
  waitForProcessesExit,
} = require('./realTwoDesktopProcessGovernance');
const { runLanE2ePreflight } = require('./windowsFirewallE2ePreflight');
const { createIsolatedPrimaryHostProfile } = require('./isolated-primary-host-profile');
const {
  rehearseAuthorityMigration,
  writeAuthorityCutoverMarker,
  hasAuthorityCutoverMarker,
} = require('../backend/src/services/authorityMigrationService');

const HOST_PASSWORD = 'RealDesktopHarnessHost-2026';
const CLIENT_PASSWORD = 'RealDesktopHarnessClient-2026';
const RUN_LOCK_PATH = path.join(os.tmpdir(), 'gewu-real-two-desktop-e2e.lock');
const MAX_PACKAGED_DESKTOP_PROCESSES = 12;
const HOST_MENU_VISIBILITY_TIMEOUT_MS = 8_000;
const HOST_MENU_ROUTE_TIMEOUT_MS = 12_000;
const EXTERNAL_VISIBLE_APPROVAL = process.env.GEWU_E2E_EXTERNAL_VISIBLE_APPROVAL === '1';
let ROOT = '';
let HOST_ROOT = '';
let CLIENT_ROOT = '';
const HOST_EXE = path.resolve(process.env.GEWU_PACKAGED_HOST_EXE || '');
const CLIENT_EXE = path.resolve(process.env.GEWU_PACKAGED_CLIENT_EXE || '');
const REQUIRED_ACCEPTANCE_FLAGS = new Set(['--lan', '--cloud-relay', '--restart', '--no-authority-data']);
const OPTIONAL_ACCEPTANCE_FLAGS = new Set(['--websocket-disabled', '--relay-websocket']);

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function initializeDisposableRoots() {
  assert.strictEqual(ROOT, '', 'REAL_TWO_DESKTOP_ROOT_ALREADY_INITIALIZED');
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-real-desktop-two-app-'));
  HOST_ROOT = path.join(ROOT, 'tmp-real-desktop-host-ui');
  CLIENT_ROOT = path.join(ROOT, 'tmp-real-desktop-client-ui');
}
function showUsage() {
  console.log([
    'Usage: node scripts/real-two-desktop-e2e.js --lan --cloud-relay --restart --no-authority-data [--websocket-disabled|--relay-websocket]',
    '',
    'Runs an isolated visible packaged primary-host and ordinary-desktop acceptance test.',
    'Required: GEWU_PACKAGED_HOST_EXE and GEWU_PACKAGED_CLIENT_EXE.',
    'A disposable loopback control plane is started automatically; no cloud credential is required.',
    'The harness audits an existing narrow LAN firewall rule; it never requests elevation.',
  ].join('\n'));
}
function assertRequiredAcceptanceFlags(argv = process.argv.slice(2)) {
  const provided = new Set(argv);
  const missing = [...REQUIRED_ACCEPTANCE_FLAGS].filter(flag => !provided.has(flag));
  const unknown = [...provided].filter(flag => !REQUIRED_ACCEPTANCE_FLAGS.has(flag) && !OPTIONAL_ACCEPTANCE_FLAGS.has(flag));
  if (missing.length || unknown.length) fail(`E2E_ACCEPTANCE_FLAGS_REQUIRED missing=${missing.join(',')} unknown=${unknown.join(',')}`);
  if (provided.has('--websocket-disabled') && provided.has('--relay-websocket')) {
    fail('E2E_TRANSPORT_MODE_CONFLICT');
  }
  return Object.freeze({
    websocketDisabled: provided.has('--websocket-disabled'),
    relayWebSocket: provided.has('--relay-websocket'),
  });
}
function assertProfile(root, marker) { assert.strictEqual(path.basename(root), marker, 'DISPOSABLE_PROFILE_REQUIRED'); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function canBindLoopbackPort(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return true;
  } catch (_error) {
    return false;
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
async function loopbackHealth(url, timeoutMs = 2_500) {
  return new Promise(resolve => childProcess.execFile('curl.exe', [
    '--fail', '--silent', '--show-error', '--output', 'NUL',
    '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1_000))), url,
  ], { windowsHide: true }, error => resolve(!error)));
}
async function waitFor(check, code, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await sleep(250);
  }
  const error = new Error(`${code}${last ? `: ${last.code || last.message}` : ''}`);
  error.code = code;
  throw error;
}
function lanAddress() {
  const candidates = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) candidates.push(entry.address);
    }
  }
  return candidates.find(address => /^192\.168\./.test(address))
    || candidates.find(address => /^10\./.test(address))
    || candidates.find(address => /^172\.(1[6-9]|2\d|3[0-1])\./.test(address))
    || fail('DIRECT_LAN_ADDRESS_REQUIRED');
}
function probeAuthoritySocket(baseUrl, timeoutMs = 8_000) {
  const url = new URL(String(baseUrl || '').trim());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/authority';
  url.search = '';
  url.hash = '';
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url.toString());
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch (_closeError) { /* probe socket is best-effort */ }
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('LAN_SOCKET_READY_REQUIRED'), {
      code: 'LAN_SOCKET_READY_REQUIRED',
    })), timeoutMs);
    socket.once('error', cause => finish(Object.assign(new Error(`LAN_SOCKET_READY_REQUIRED: ${cause?.message || 'UNKNOWN'}`), {
      code: 'LAN_SOCKET_READY_REQUIRED',
      cause,
    })));
    socket.on('message', raw => {
      try {
        const frame = JSON.parse(raw.toString('utf8'));
        if (frame?.protocol === 'gewu.authority-socket.v1' && frame.type === 'ready') finish();
      } catch (_error) { /* wait for the definitive socket timeout */ }
    });
  });
}
async function assertLanIsolated(baseUrl) {
  let reachable = false;
  try {
    await fetch(`${baseUrl}/api/health`);
    reachable = true;
  } catch (_error) { /* a refused loopback endpoint proves LAN is unavailable */ }
  assert.strictEqual(reachable, false, 'LAN_ISOLATION_REQUIRED');
}
function baseConfig(root, input) {
  return {
    desktopIdentityMode: 'full', primaryHostEpochId: '', primaryHostGeneration: null,
    desktopSyncToken: '', questionBankPath: '', questionAssetPath: '', questionBankCandidatePaths: [], questionBankStoreId: '',
    nasBackupPath: '', ...input,
    mainDbPath: path.join(root, 'data', 'scheduling.db'),
    localCachePath: path.join(root, 'local-cache'),
  };
}
function writeConfig(root, config) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'gewugongfang.config.json'), JSON.stringify(config, null, 2), 'utf8');
}
function prepareHost({ backendPort, cloudBaseUrl }) {
  createIsolatedPrimaryHostProfile({ root: ROOT, profilePath: HOST_ROOT, hostPort: backendPort, cloudBaseUrl });
  const deviceId = 'real_e2e_two_app_host';
  const config = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'gewugongfang.config.json'), 'utf8'));
  config.deviceId = deviceId;
  config.hostBaseUrl = `http://${lanAddress()}:${backendPort}`;
  writeConfig(HOST_ROOT, config);
  const previous = process.env.DB_PATH;
  process.env.DB_PATH = config.mainDbPath;
  const service = new DatabaseService();
  try {
    const owner = service.db.prepare('SELECT id FROM users WHERE id=? AND deleted=0').get(CANONICAL_SUPER_ADMIN_ID);
    assert(owner, 'TEST_CANONICAL_OWNER_REQUIRED');
    const questionBankPath = path.join(HOST_ROOT, 'question-bank');
    const manifest = initQuestionBankStore(questionBankPath, { deviceId });
    const binding = bindQuestionBankStoreToDatabase({
      db: service.db, root: questionBankPath,
      authz: { role: 'super_admin', userId: owner.id, deviceTrusted: true, deviceActive: true, deviceOwnerUserId: owner.id, userApproved: true, isPrimaryHost: true },
      runtime: { nodeRole: 'primary-host', clientType: 'desktop', tokenUse: 'desktop-session', deviceId, tokenDeviceId: deviceId },
    });
    writeConfig(HOST_ROOT, { ...config, questionBankPath, questionAssetPath: path.join(questionBankPath, 'assets'), questionBankCandidatePaths: [questionBankPath], questionBankStoreId: binding.storeId || manifest.storeId });
  } finally {
    service.close();
    if (previous === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = previous;
  }
}
function prepareClient({ hostBaseUrl, cloudBaseUrl }) {
  fs.mkdirSync(CLIENT_ROOT, { recursive: true });
  childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'prepare-isolated-desktop-client.js'),
    path.join(CLIENT_ROOT, 'gewugongfang.config.json'), hostBaseUrl, cloudBaseUrl, 'real_e2e_two_app_client',
  ], { stdio: 'ignore', windowsHide: true });
}
function authorizeIsolatedCutoverFixture() {
  const authorityDb = path.join(HOST_ROOT, 'data', 'scheduling.db');
  const copyDb = path.join(ROOT, 'isolated-authority-cutover-copy.db');
  const report = rehearseAuthorityMigration({
    sourceDb: authorityDb,
    copyDb,
    authorityId: 'isolated-two-desktop-acceptance',
    commandReplay: ({ db, authorityId }) => {
      const failures = [];
      const account = db.prepare("SELECT status FROM authority_accounts WHERE authority_id=? AND user_id=?")
        .get(authorityId, CANONICAL_SUPER_ADMIN_ID);
      if (account?.status !== 'active') failures.push('ISOLATED_CUTOVER_REPLAY_ACCOUNT_REQUIRED');
      const grant = db.prepare("SELECT 1 AS ok FROM authority_role_bindings WHERE authority_id=? AND user_id=? AND role='super_admin' AND status='active'")
        .get(authorityId, CANONICAL_SUPER_ADMIN_ID);
      if (!grant) failures.push('ISOLATED_CUTOVER_REPLAY_GRANT_REQUIRED');
      return failures;
    },
  });
  writeAuthorityCutoverMarker({ authorityDb, report });
  assert.strictEqual(hasAuthorityCutoverMarker({ authorityDb, sourceFingerprint: report.sourceFingerprintBefore }), true,
    'ISOLATED_CUTOVER_MARKER_REQUIRED');
  return report;
}
function startIdentityCloud({ port }) {
  const cloudRoot = path.join(ROOT, 'tmp-real-desktop-identity-cloud-control');
  const diagnosticLog = path.join(cloudRoot, 'authority-http.log');
  fs.mkdirSync(cloudRoot, { recursive: true });
  const diagnosticStream = fs.createWriteStream(diagnosticLog, { flags: 'a' });
  const child = childProcess.spawn(process.execPath, [path.join(__dirname, 'isolated-desktop-identity-cloud.js'), cloudRoot, String(port)], {
    cwd: __dirname, detached: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
  });
  child.stdout.pipe(diagnosticStream);
  child.stderr.pipe(diagnosticStream);
  return { child, baseUrl: `http://127.0.0.1:${port}`, diagnosticLog, readyMarker: `\"ready\":true,\"port\":${port}` };
}
function startProcessGuardian(root, lockPath) {
  const child = childProcess.spawn(process.execPath, [
    path.join(__dirname, 'realTwoDesktopProcessGuardian.js'),
    root,
    lockPath,
    String(process.pid),
  ], {
    cwd: __dirname,
    detached: false,
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.on('error', () => {});
  return child;
}
async function stopProcessGuardian(child) {
  if (!child || child.exitCode !== null) return true;
  child.stdin.end();
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 20_000)),
  ]);
  if (exited) return true;
  try {
    childProcess.execFileSync('taskkill', ['/PID', String(child.pid), '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 15_000,
    });
  } catch (_alreadyExited) {}
  console.error(`[e2e] PROCESS_GUARDIAN_EXIT_DEFERRED pid=${child.pid}`);
  return false;
}
function listLiveDisposableDesktopProcesses() {
  const command = [
    '$rows = Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ProcessId -ne $PID -and',
    "  [string]$_.CommandLine -match '--user-data-dir=' -and",
    "  [string]$_.CommandLine -match 'tmp-real-desktop-two-app-'",
    '} | Select-Object ProcessId,CommandLine;',
    '@($rows) | ConvertTo-Json -Compress',
  ].join(' ');
  let parsed;
  try {
    const output = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    }).trim();
    parsed = output ? JSON.parse(output) : [];
  } catch (error) {
    throw Object.assign(new Error(`REAL_TWO_DESKTOP_PROCESS_AUDIT_FAILED ${error?.message || error}`), {
      code: 'REAL_TWO_DESKTOP_PROCESS_AUDIT_FAILED',
    });
  }
  return (Array.isArray(parsed) ? parsed : [parsed]).map(row => {
    const commandLine = String(row?.CommandLine || '');
    const profileMatch = commandLine.match(/--user-data-dir=(?:\"([^\"]+)\"|([^\s\"]+))/i);
    const profileRoot = profileMatch?.[1] || profileMatch?.[2] || '';
    const rootMatch = commandLine.match(/tmp-real-desktop-two-app-[^\\\s\"]+/i);
    return {
      pid: Number(row?.ProcessId),
      root: rootMatch?.[0] || '',
      profileRoot,
    };
  }).filter(row => Number.isInteger(row.pid) && row.pid > 0 && row.root);
}
function assertCurrentProcessBudget() {
  return assertPackagedDesktopProcessBudget(listLiveDisposableDesktopProcesses(), {
    activeRoot: path.basename(ROOT),
    maxProcesses: MAX_PACKAGED_DESKTOP_PROCESSES,
  });
}
async function waitForIdentityCloudReady(cloud, timeoutMs = 20_000) {
  return waitFor(() => {
    try { return fs.readFileSync(cloud.diagnosticLog, 'utf8').includes(cloud.readyMarker); } catch (_error) { return false; }
  }, 'IDENTITY_CLOUD_LISTEN_READY_REQUIRED', timeoutMs).then(() => true).catch(() => false);
}
async function postJson(url) {
  const response = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`IDENTITY_CLOUD_REQUEST_FAILED:${response.status}`);
  const payload = await response.json();
  if (payload?.success !== true) throw new Error(payload?.code || 'IDENTITY_CLOUD_REQUEST_FAILED');
  return payload.data || payload;
}
async function assertAuthorityControlPlane(cloudBaseUrl) {
  const stdout = await new Promise((resolve, reject) => childProcess.execFile('curl.exe', [
    '--silent', '--show-error', '--request', 'POST', '--header', 'content-type: application/json',
    '--data', JSON.stringify({ protocol: 'gewu.authority-command.v1' }), '--write-out', '\\n%{http_code}',
    `${cloudBaseUrl}/api/authority/commands`,
  ], { windowsHide: true, maxBuffer: 128 * 1024 }, (error, output, stderr) => {
    if (error) reject(new Error(`AUTHORITY_CONTROL_PLANE_CURL_FAILED:${stderr || error.message}`));
    else resolve(output);
  }));
  const marker = stdout.lastIndexOf('\n');
  const payload = JSON.parse(stdout.slice(0, marker));
  assert.strictEqual(Number(stdout.slice(marker + 1)), 401, 'AUTHORITY_CONTROL_PLANE_AUTH_REQUIRED');
  assert.strictEqual(payload?.error?.code, 'AUTHORITY_ACTOR_REQUIRED', 'AUTHORITY_CONTROL_PLANE_CONTRACT_REQUIRED');
}
function startDesktop(exe, root, backendPort, cdpPort, { websocketDisabled = false } = {}) {
  assert(fs.existsSync(exe), 'PACKAGED_DESKTOP_EXE_REQUIRED');
  const runtimeConfig = JSON.parse(fs.readFileSync(path.join(root, 'gewugongfang.config.json'), 'utf8'));
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(String(runtimeConfig.managedCloudBaseUrl || '')),
    'ISOLATED_MANAGED_CLOUD_URL_REQUIRED');
  const diagnosticLog = path.join(root, 'e2e-packaged-desktop.log');
  const diagnosticFd = fs.openSync(diagnosticLog, 'a');
  let child;
  try {
    child = childProcess.spawn(exe, [`--user-data-dir=${root}`, `--remote-debugging-port=${cdpPort}`, '--enable-logging=stderr'], {
      cwd: path.dirname(exe), detached: false, windowsHide: false, stdio: ['ignore', diagnosticFd, diagnosticFd],
      env: {
        ...process.env,
        PORT: String(backendPort),
        ...(websocketDisabled ? { GEWU_AUTHORITY_WEBSOCKET_DISABLED: '1' } : {}),
        GEWU_E2E_LAN: '1',
        GEWU_E2E_CLOUD_RELAY: '1',
        GEWU_E2E_NO_AUTHORITY_DATA: '1',
        GEWU_E2E_MANAGED_CLOUD_BASE_URL: runtimeConfig.managedCloudBaseUrl,
      },
    });
  } finally {
    fs.closeSync(diagnosticFd);
  }
  child.once('error', error => {
    try { fs.appendFileSync(diagnosticLog, `DESKTOP_SPAWN_ERROR ${error.stack || error.message}\n`, 'utf8'); } catch (_ignored) {}
  });
  return child;
}
function activateDesktopWindow(child, code) {
  const pid = Number(child?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) fail(code);
  const activationScript = path.join(__dirname, 'restoreProcessWindow.ps1');
  try {
    childProcess.execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', activationScript,
      '-ProcessId', String(pid),
    ], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (_error) {
    fail(code);
  }
}
async function stopProfile(root, child) {
  const pids = new Set(child?.pid ? [child.pid] : []);
  const normalizedRoot = path.resolve(root).toLowerCase();
  for (const row of listLiveDisposableDesktopProcesses()) {
    if (path.resolve(row.profileRoot || '').toLowerCase() === normalizedRoot) pids.add(row.pid);
  }
  for (const pid of pids) {
    // The set is derived only from the exact disposable profile marker. Do not
    // use taskkill /T: on Windows it can traverse through a launcher relation
    // and kill the E2E runner that owns the visible acceptance sequence.
    try { childProcess.execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' }); } catch (_error) { /* already exited */ }
  }
  try {
    await waitForProcessesExit([...pids], { timeoutMs: 15_000 });
    return true;
  } catch (error) {
    console.error(`[e2e] TEMPORARY_PROFILE_PROCESS_EXIT_DEFERRED root=${root} code=${error?.code || 'UNKNOWN'}`);
    return false;
  }
}
function literal(value) { return JSON.stringify(value); }
async function withFreshCdpPage(cdpPort, profileRoot, label, action) {
  let page;
  try {
    page = await connectRealDesktopPage({ cdpPort, profileRoot, timeoutMs: 15_000 });
    return await action(page);
  } catch (error) {
    const detail = String(error?.stack || error?.message || error || '').replace(/\s+/g, ' ').slice(0, 1000);
    throw Object.assign(new Error(`REAL_DESKTOP_CDP_ACTION_FAILED ACTION=${label} DETAIL=${detail}`), { code: 'REAL_DESKTOP_CDP_ACTION_FAILED' });
  } finally {
    await page?.close().catch(() => {});
  }
}
async function nativeTargetCenter(page, selector) {
  const center = await page.evaluate(`(() => { const item = document.querySelector(${literal(selector)}); if (!item) return null; item.scrollIntoView({ block: 'center', inline: 'center' }); const rect = item.getBoundingClientRect(); if (!(rect.width > 0 && rect.height > 0)) return null; const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, hitTarget: Boolean(hit && (hit === item || item.contains(hit))) }; })()`);
  if (!center) throw new Error('REAL_DESKTOP_CDP_TARGET_MISSING');
  if (!center.hitTarget) throw new Error('REAL_DESKTOP_CDP_TARGET_OBSCURED');
  return center;
}
async function nativeClickDirect(page, selector) {
  await page.send('Page.bringToFront');
  const { x, y } = await nativeTargetCenter(page, selector);
  const clickProbe = `real-click-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.evaluate(`(() => {
    const key = ${literal(clickProbe)};
    const target = document.querySelector(${literal(selector)});
    if (!target) throw new Error('REAL_DESKTOP_CDP_CLICK_TARGET_LOST');
    target.dataset.realDesktopNativeClickProbe = key;
    window.__realDesktopClickProbe = { key, observed: false };
    document.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('[data-real-desktop-native-click-probe]')?.dataset.realDesktopNativeClickProbe === key) {
        window.__realDesktopClickProbe.observed = true;
      }
    }, { capture: true, once: true });
  })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await sleep(80);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(50);
  const observed = await page.evaluate(`(() => {
    const value = window.__realDesktopClickProbe?.key === ${literal(clickProbe)}
      ? window.__realDesktopClickProbe.observed
      : false;
    delete window.__realDesktopClickProbe;
    document.querySelector(${literal(selector)})?.removeAttribute('data-real-desktop-native-click-probe');
    return value;
  })()`);
  if (!observed) throw new Error('REAL_DESKTOP_CDP_CLICK_EVENT_MISSING');
}
function actionPage(cdpPort, profileRoot) {
  return Object.freeze({
    evaluate: expression => withFreshCdpPage(cdpPort, profileRoot, `evaluate:${String(expression).replace(/\s+/g, ' ').slice(0, 160)}`, page => page.evaluate(expression)),
    networkOffline: () => withFreshCdpPage(cdpPort, profileRoot, 'network-offline', async page => {
      await page.send('Network.enable');
      await page.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      return true;
    }),
    networkOnline: () => withFreshCdpPage(cdpPort, profileRoot, 'network-online', async page => {
      await page.send('Network.enable');
      await page.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      return true;
    }),
    nativeFill: (selector, value) => withFreshCdpPage(cdpPort, profileRoot, `native-fill:${selector}`, async page => {
      await nativeClickDirect(page, selector);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await page.send('Input.insertText', { text: String(value) });
      const current = await page.evaluate(`(() => document.querySelector(${literal(selector)})?.value || null)()`);
      if (current !== String(value)) throw new Error('REAL_DESKTOP_CDP_NATIVE_FILL_FAILED');
    }),
    nativeClick: selector => withFreshCdpPage(cdpPort, profileRoot, `native-click:${selector}`, page => nativeClickDirect(page, selector)),
    nativeMove: ({ x, y }) => withFreshCdpPage(cdpPort, profileRoot, 'native-move', page => page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', buttons: 0,
    })),
    close: async () => {},
  });
}
async function body(page) { return String(await page.evaluate('document.body.innerText || ""')); }
async function fillByPlaceholder(page, placeholder, value) {
  await page.nativeFill(`[placeholder=${literal(placeholder)}]`, value);
  await sleep(300);
}
async function clickText(page, text) {
  const actionKey = `real-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const selector = await page.evaluate(`(() => { const text = ${literal(text)}.replace(/\\s+/g, ''); const key = ${literal(actionKey)}; const matches = item => (item.innerText || '').replace(/\\s+/g, '') === text && !item.closest('[aria-disabled="true"]'); const interactive = Array.from(document.querySelectorAll('button,[role="button"],a')).find(matches); const fallback = interactive ? null : Array.from(document.querySelectorAll('span,div')).find(matches); const clickable = interactive || fallback?.closest('button,[role="button"],a'); if (!clickable) return null; clickable.dataset.realDesktopAction = key; return '[data-real-desktop-action="' + key + '"]'; })()`);
  if (!selector) fail('REAL_DESKTOP_UI_ACTION_MISSING');
  await page.nativeClick(selector);
}
async function clickTextWhenAvailable(page, text, code, timeoutMs = 15_000) {
  return waitFor(async () => {
    try {
      await clickText(page, text);
      return true;
    } catch (error) {
      if (error?.code === 'REAL_DESKTOP_UI_ACTION_MISSING') return null;
      throw error;
    }
  }, code, timeoutMs);
}
async function clickVisibleModalText(page, text) {
  const actionKey = `real-modal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const selector = await page.evaluate(`(() => {
    const text = ${literal(text)}.replace(/\\s+/g, '');
    const key = ${literal(actionKey)};
    const visible = item => {
      const style = window.getComputedStyle(item);
      const rect = item.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const modal = Array.from(document.querySelectorAll('.ant-modal-wrap')).reverse().find(item => visible(item)
      && (item.innerText || '').replace(/\\s+/g, '').includes(text));
    const button = modal && Array.from(modal.querySelectorAll('button,[role="button"]'))
      .find(item => (item.innerText || '').replace(/\\s+/g, '') === text && !item.closest('[aria-disabled="true"]'));
    if (!button) return null;
    button.dataset.realDesktopAction = key;
    return '[data-real-desktop-action="' + key + '"]';
  })()`);
  if (!selector) fail('REAL_DESKTOP_VISIBLE_MODAL_ACTION_MISSING');
  await page.nativeClick(selector);
}
async function waitBody(page, text, code, timeoutMs) {
  return waitFor(async () => (await body(page)).includes(text), code, timeoutMs);
}
async function ensurePinnedNavigation(page) {
  const isPinned = await page.evaluate(`(() => document.querySelector('.app-shell__sider')?.classList.contains('app-shell__sider--pinned') === true)()`);
  if (!isPinned) {
    await waitFor(async () => page.evaluate(`(() => { const item = document.querySelector('.app-shell__collapse-button'); const rect = item?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0); })()`), 'HOST_NAVIGATION_TOGGLE_REQUIRED');
    await waitFor(async () => {
      try {
        await page.nativeClick('.app-shell__collapse-button');
        return true;
      } catch (error) {
        if (error?.message?.includes('REAL_DESKTOP_CDP_TARGET_OBSCURED')) return null;
        throw error;
      }
    }, 'CLIENT_NAVIGATION_TOGGLE_OBSCURED_RETRY_REQUIRED');
  }
  await waitFor(async () => page.evaluate(`(() => document.querySelector('.app-shell__sider')?.classList.contains('app-shell__sider--pinned') === true)()`), 'HOST_NAVIGATION_PIN_REQUIRED');
  await waitFor(async () => page.evaluate(`(() => { const sider = document.querySelector('.app-shell__sider'); const rect = sider?.getBoundingClientRect(); return Boolean(rect && rect.left >= -1 && rect.width >= 230); })()`), 'HOST_NAVIGATION_VISIBLE_REQUIRED');
}
async function markVisibleMenuTarget(page, selector) {
  const targetKey = `real-menu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return page.evaluate(`(() => {
    const targetKey = ${literal(targetKey)};
    const items = Array.from(document.querySelectorAll(${literal(selector)}));
    const item = items.find(candidate => {
      const rect = candidate.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (!(rect.right > 0 && rect.bottom > 0 && rect.top < window.innerHeight
        && rect.width > 0 && rect.height > 0
        && centerX >= 0 && centerX <= window.innerWidth
        && centerY >= 0 && centerY <= window.innerHeight)) return false;
      const hit = document.elementFromPoint(centerX, centerY);
      return Boolean(hit && (hit === candidate || candidate.contains(hit)));
    });
    if (!item) return null;
    item.dataset.realDesktopMenuTarget = targetKey;
    return '[data-real-desktop-menu-target="' + targetKey + '"]';
  })()`);
}
async function ensureVisibleMenuElement(page, selector, code) {
  // The sidebar can finish its exit animation between two nested navigation
  // actions. A menu selector can also resolve an AntD animation duplicate;
  // only a visible element that wins the center-point hit test is clickable.
  let target = await markVisibleMenuTarget(page, selector);
  if (!target) await ensurePinnedNavigation(page);
  return waitFor(async () => {
    target = await markVisibleMenuTarget(page, selector);
    if (target) return target;
    await ensurePinnedNavigation(page);
    return markVisibleMenuTarget(page, selector);
  }, code, HOST_MENU_VISIBILITY_TIMEOUT_MS);
}
async function menuGroupPainted(page, selector) {
  return page.evaluate(`(() => {
    const groups = Array.from(document.querySelectorAll(${literal(selector)}));
    return groups.some(group => {
      if (group.getAttribute('aria-expanded') !== 'true') return false;
      const groupRoot = group.matches('.ant-menu-submenu') ? group : group.closest('.ant-menu-submenu');
      const submenu = groupRoot?.querySelector('.ant-menu-sub');
      const submenuBox = submenu?.getBoundingClientRect();
      if (!submenu || !submenuBox || !(submenuBox.height > 0)) return false;
      if (submenu.classList.contains('ant-motion-collapse-enter-start')) return false;
      const item = Array.from(submenu.querySelectorAll('.ant-menu-item')).find(candidate => {
        const rect = candidate.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return false;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && submenu.contains(hit) && (hit === candidate || candidate.contains(hit)));
      });
      return Boolean(item);
    });
  })()`);
}
async function waitForPaintedMenuGroup(page, selector, code) {
  return waitFor(() => menuGroupPainted(page, selector), code, HOST_MENU_VISIBILITY_TIMEOUT_MS);
}
async function openMenuGroup(page, groupKey, code) {
  const selector = `[data-menu-id$="-${groupKey}"]`;
  let target;
  try {
    target = await ensureVisibleMenuElement(page, selector, 'HOST_MENU_GROUP_VISIBLE_REQUIRED');
  } catch (cause) {
    const menuState = await page.evaluate(`(() => {
      const sider = document.querySelector('.app-shell__sider');
      const siderRect = sider?.getBoundingClientRect();
      return {
        selector: ${literal(selector)},
        siderClass: sider?.className || null,
        siderRect: siderRect ? { left: siderRect.left, right: siderRect.right, width: siderRect.width, height: siderRect.height } : null,
        candidates: Array.from(document.querySelectorAll(${literal(selector)})).map(item => {
          const rect = item.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { className: item.className, ariaExpanded: item.getAttribute('aria-expanded'), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }, hitTag: hit?.tagName || null };
        }),
        contentPage: document.querySelector('.app-shell__content')?.className || null,
      };
    })()`);
    throw Object.assign(new Error(`HOST_MENU_GROUP_VISIBLE_REQUIRED MENU_GROUP_STATE=${JSON.stringify(menuState)}`), {
      code: cause.code || code || 'HOST_MENU_GROUP_VISIBLE_REQUIRED',
    });
  }
  let isOpen = await page.evaluate(`(() => document.querySelector(${literal(target)})?.getAttribute('aria-expanded') === 'true')()`);
  const isPainted = isOpen ? await menuGroupPainted(page, selector) : false;
  if (isOpen && !isPainted) {
    await page.nativeClick(target);
    await waitFor(async () => page.evaluate(`(() => document.querySelector(${literal(target)})?.getAttribute('aria-expanded') === 'false')()`), 'HOST_MENU_GROUP_REOPEN_REQUIRED', HOST_MENU_VISIBILITY_TIMEOUT_MS);
    target = await ensureVisibleMenuElement(page, selector, 'HOST_MENU_GROUP_VISIBLE_REQUIRED');
    isOpen = false;
  }
  if (!isOpen) {
    await page.nativeClick(target);
  }
  await waitFor(async () => page.evaluate(`(() => document.querySelector(${literal(target)})?.getAttribute('aria-expanded') === 'true')()`), code, HOST_MENU_VISIBILITY_TIMEOUT_MS);
  try {
    await waitForPaintedMenuGroup(page, selector, 'HOST_MENU_GROUP_PAINTED_REQUIRED');
  } catch (cause) {
    const paintDiagnostic = await page.evaluate(`new Promise(resolve => {
      const startedAt = performance.now();
      let settled = false;
      const finish = frameAdvanced => {
        if (settled) return;
        settled = true;
        const group = Array.from(document.querySelectorAll(${literal(selector)}))
          .find(candidate => candidate.getAttribute('aria-expanded') === 'true') || null;
        const groupRoot = group?.matches('.ant-menu-submenu') ? group : group?.closest('.ant-menu-submenu');
        const submenu = groupRoot?.querySelector('.ant-menu-sub') || null;
        const submenuBox = submenu?.getBoundingClientRect() || null;
        resolve({
          diagnostic: 'MENU_GROUP_PAINT_DIAGNOSTIC',
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
          frameAdvanced,
          elapsedMs: Math.round(performance.now() - startedAt),
          groupClass: group?.className || null,
          submenuClass: submenu?.className || null,
          submenuRect: submenuBox ? { width: submenuBox.width, height: submenuBox.height } : null,
        });
      };
      requestAnimationFrame(() => finish(true));
      setTimeout(() => finish(false), 1200);
    })`);
    throw Object.assign(new Error(`HOST_MENU_GROUP_PAINTED_REQUIRED MENU_GROUP_PAINT_STATE=${JSON.stringify(paintDiagnostic)}`), {
      code: cause.code || 'HOST_MENU_GROUP_PAINTED_REQUIRED',
    });
  }
}
async function openMenuItem(page, itemKey, code) {
  const selector = `[data-menu-id$="-${itemKey}"]`;
  let target;
  try {
    target = await ensureVisibleMenuElement(page, selector, 'HOST_MENU_ITEM_VISIBLE_REQUIRED');
  } catch (cause) {
    const menuState = await page.evaluate(`(() => {
      const item = document.querySelector(${literal(selector)});
      const sider = document.querySelector('.app-shell__sider');
      const rect = item?.getBoundingClientRect();
      const siderRect = sider?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : -1;
      const centerY = rect ? rect.top + rect.height / 2 : -1;
      const hit = rect ? document.elementFromPoint(centerX, centerY) : null;
      const itemStyle = item ? window.getComputedStyle(item) : null;
      const hitStyle = hit ? window.getComputedStyle(hit) : null;
      const submenu = item?.closest('.ant-menu-sub') || null;
      const submenuStyle = submenu ? window.getComputedStyle(submenu) : null;
      const submenuBox = submenu?.getBoundingClientRect() || null;
      return {
        diagnostic: 'MENU_TARGET_HIT_DIAGNOSTIC',
        selector: ${literal(selector)},
        itemClass: item?.className || null,
        itemRect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
        hitTag: hit?.tagName || null,
        hitClass: hit?.className || null,
        hitText: (hit?.innerText || hit?.textContent || '').replace(/\s+/g, ' ').slice(0, 160),
        itemPointerEvents: itemStyle?.pointerEvents || null,
        hitPointerEvents: hitStyle?.pointerEvents || null,
        itemVisibility: itemStyle?.visibility || null,
        itemOpacity: itemStyle?.opacity || null,
        itemTransform: itemStyle?.transform || null,
        hitTransform: hitStyle?.transform || null,
        submenuClass: submenu?.className || null,
        submenuRect: submenuBox ? { left: submenuBox.left, right: submenuBox.right, top: submenuBox.top, bottom: submenuBox.bottom, width: submenuBox.width, height: submenuBox.height } : null,
        submenuOverflow: submenuStyle?.overflow || null,
        submenuDisplay: submenuStyle?.display || null,
        siderClass: sider?.className || null,
        siderRect: siderRect ? { left: siderRect.left, right: siderRect.right, width: siderRect.width } : null,
      };
    })()`);
    throw Object.assign(new Error(`HOST_MENU_ITEM_VISIBLE_REQUIRED MENU_STATE=${JSON.stringify(menuState)}`), {
      code: cause.code || 'HOST_MENU_ITEM_VISIBLE_REQUIRED',
    });
  }
  await sleep(400); // HOST_MENU_ITEM_SETTLED_REQUIRED
  await waitFor(async () => {
    target = await ensureVisibleMenuElement(page, selector, 'HOST_MENU_ITEM_VISIBLE_REQUIRED');
    await page.nativeClick(target);
    await sleep(700);
    return page.evaluate(`(() => {
      const selected = document.querySelector(${literal(target)})?.classList.contains('ant-menu-item-selected') === true;
      const routeRendered = document.querySelector('.app-shell__content')?.classList.contains('app-shell__content--${itemKey}') === true;
      return selected && routeRendered;
    })()`);
  }, code, HOST_MENU_ROUTE_TIMEOUT_MS);
}
async function openHostIdentity(page) {
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await ensurePinnedNavigation(page);
        await openMenuGroup(page, 'system-data', 'HOST_SYSTEM_DATA_NAVIGATION_REQUIRED');
        await openMenuItem(page, 'identity-devices', 'HOST_IDENTITY_ROUTE_REQUIRED');
        await waitFor(async () => {
          await ensurePinnedNavigation(page);
          await openMenuItem(page, 'identity-devices', 'HOST_IDENTITY_ROUTE_REQUIRED');
          return (await body(page)).includes('\u6211\u7684\u8bbe\u5907') || null;
        }, 'HOST_IDENTITY_UI_MISSING', 15_000);
        await waitBody(page, '\u6211\u7684\u8bbe\u5907', 'HOST_IDENTITY_UI_MISSING', 5_000);
        return;
      } catch (error) {
        lastError = error;
        await sleep(800);
      }
    }
    throw lastError || new Error('HOST_IDENTITY_ROUTE_REQUIRED');
  } finally {
    await releaseNavigationOverlay(page);
  }
  try {
    await waitBody(page, '\u6211\u7684\u8bbe\u5907', 'HOST_IDENTITY_UI_MISSING');
  } catch (cause) {
    const rendered = (await body(page)).replace(/\s+/g, ' ').slice(0, 1600);
    throw Object.assign(new Error(`${cause.code || cause.message} PAGE=${rendered}`), { code: cause.code || 'HOST_IDENTITY_UI_MISSING' });
  }
}
async function releaseNavigationOverlay(page) {
  const isPinned = await page.evaluate(`(() => document.querySelector('.app-shell__sider')?.classList.contains('app-shell__sider--pinned') === true)()`);
  if (isPinned) {
    await page.nativeClick('.app-shell__sider-unpin');
    await waitFor(async () => page.evaluate(`(() => document.querySelector('.app-shell__sider')?.classList.contains('app-shell__sider--pinned') !== true)()`), 'HOST_NAVIGATION_UNPIN_REQUIRED');
  }
  const safePoint = await page.evaluate(`(() => ({ x: Math.max(800, window.innerWidth - 80), y: Math.max(500, window.innerHeight - 80) }))()`);
  await page.nativeMove(safePoint);
  await waitFor(async () => page.evaluate(`(() => document.querySelector('.app-shell__sider')?.classList.contains('app-shell__sider--open') !== true)()`), 'HOST_NAVIGATION_OVERLAY_HIDDEN_REQUIRED');
  await waitFor(async () => page.evaluate(`(() => {
    const rect = document.querySelector('.app-shell__sider')?.getBoundingClientRect();
    return Boolean(rect && rect.right <= 1);
  })()`), 'HOST_NAVIGATION_RETREATED_REQUIRED');
}
async function initializeHost(page, hostPort, hostCdpPort, cloudBaseUrl) {
  const initial = await waitFor(async () => {
    const current = await body(page);
    return current.includes('\u5f00\u59cb\u5fae\u4fe1\u8eab\u4efd\u6ce8\u518c') || current.includes('\u5907\u4efd\u5e76\u5b8c\u6210\u521d\u59cb\u5316') || current.includes('\u9a8c\u8bc1\u5e76\u8fdb\u5165') ? current : null;
  }, 'HOST_IDENTITY_GATE_REQUIRED');
  if (initial.includes('\u5f00\u59cb\u5fae\u4fe1\u8eab\u4efd\u6ce8\u518c')) {
    await clickTextWhenAvailable(page, '\u5f00\u59cb\u5fae\u4fe1\u8eab\u4efd\u6ce8\u518c', 'HOST_BOOTSTRAP_IDENTITY_BEGIN_REQUIRED');
    await waitFor(async () => {
      const current = await body(page);
      return /\b[0-9]{6}\b/.test(current) || current.includes('\u7b49\u5f85\u53e6\u4e00\u53f0\u5df2\u6388\u6743\u8bbe\u5907\u5ba1\u6838') ? current : null;
    }, 'HOST_BOOTSTRAP_IDENTITY_CHALLENGE_REQUIRED');
    await postJson(`${cloudBaseUrl}/__e2e/confirm-latest`);
    await waitBody(page, '\u7b49\u5f85\u53e6\u4e00\u53f0\u5df2\u6388\u6743\u8bbe\u5907\u5ba1\u6838', 'HOST_BOOTSTRAP_APPROVAL_PENDING_REQUIRED');
    await postJson(`${cloudBaseUrl}/__e2e/approve-latest-bootstrap-host`);
    await waitBody(page, '\u8bbe\u5907\u5ba1\u6838\u5df2\u901a\u8fc7', 'HOST_BOOTSTRAP_APPROVED_REQUIRED');
    await fillByPlaceholder(page, '\u81f3\u5c11 6 \u4e2a\u5b57\u7b26', HOST_PASSWORD);
    await fillByPlaceholder(page, '\u518d\u6b21\u8f93\u5165\u672c\u673a\u5bc6\u7801', HOST_PASSWORD);
    await clickTextWhenAvailable(page, '\u4fdd\u5b58\u672c\u673a\u5bc6\u7801\u5e76\u8fdb\u5165', 'HOST_BOOTSTRAP_LOCAL_PASSWORD_SUBMIT_REQUIRED');
    await waitBody(page, '\u9501\u5b9a', 'HOST_BOOTSTRAP_UNLOCK_UI_REQUIRED');
  } else if (initial.includes('\u5907\u4efd\u5e76\u5b8c\u6210\u521d\u59cb\u5316')) {
    console.log('[e2e] host initialization UI visible');
    await fillByPlaceholder(page, '\u8bbe\u7f6e\u672c\u673a\u5bc6\u7801\uff08\u81f3\u5c11 6 \u4e2a\u5b57\u7b26\uff09', HOST_PASSWORD);
    await fillByPlaceholder(page, '\u518d\u6b21\u8f93\u5165\u672c\u673a\u5bc6\u7801', HOST_PASSWORD);
    await clickText(page, '\u5907\u4efd\u5e76\u5b8c\u6210\u521d\u59cb\u5316');
    console.log('[e2e] host initialization submitted');
    await waitFor(() => fs.existsSync(path.join(HOST_ROOT, 'desktop-identity-v2.bin')), 'HOST_IDENTITY_VAULT_NOT_CREATED');
    await sleep(2500);
  }
  await waitFor(async () => {
    const probe = await connectRealDesktopPage({ cdpPort: hostCdpPort, profileRoot: HOST_ROOT });
    await probe.close();
    return true;
  }, 'HOST_RELAUNCH_CDP_MISSING', 45_000);
  const relaunched = actionPage(hostCdpPort, HOST_ROOT);
  const postBootstrap = await waitFor(async () => {
    const current = await body(relaunched);
    return current.includes('\u9a8c\u8bc1\u5e76\u8fdb\u5165') || current.includes('\u7cfb\u7edf\u4e0e\u6570\u636e') ? current : null;
  }, 'HOST_UNLOCK_GATE_REQUIRED');
  if (postBootstrap.includes('\u9a8c\u8bc1\u5e76\u8fdb\u5165')) {
    await fillByPlaceholder(relaunched, '\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801', HOST_PASSWORD);
    await clickText(relaunched, '\u9a8c\u8bc1\u5e76\u8fdb\u5165');
  } else {
    console.log('[e2e] HOST_DIRECT_RUNTIME_AFTER_BOOTSTRAP_REQUIRED');
  }
  await waitBody(relaunched, '\u7cfb\u7edf\u4e0e\u6570\u636e', 'HOST_MAIN_NAVIGATION_REQUIRED');
  console.log('[e2e] host unlock UI completed');
  await waitFor(() => loopbackHealth(`http://127.0.0.1:${hostPort}/api/health`), 'HOST_BACKEND_RESTART_REQUIRED');
  return relaunched;
}
async function bootstrapHostAuthorityThroughUi(page, hostPort, hostCdpPort, cloudBaseUrl, hostProcess, acceptance) {
  console.log('[e2e] host authority bootstrap: open identity navigation');
  await openHostIdentity(page);
  console.log('[e2e] host authority bootstrap: identity navigation ready');
  await waitBody(page, '\u5f00\u59cb\u5efa\u7acb\u4e3b\u673a\u8eab\u4efd', 'HOST_AUTHORITY_BOOTSTRAP_ENTRY_REQUIRED');
  console.log('[e2e] host authority bootstrap: start action visible');
  await clickTextWhenAvailable(page, '\u5f00\u59cb\u5efa\u7acb\u4e3b\u673a\u8eab\u4efd', 'HOST_AUTHORITY_BOOTSTRAP_START_REQUIRED');
  console.log('[e2e] host authority bootstrap: start action submitted');
  await waitBody(page, '\u5efa\u7acb\u53d7\u7ba1\u672c\u5730\u6570\u636e\u4e3b\u673a', 'HOST_AUTHORITY_BOOTSTRAP_DIALOG_REQUIRED');
  await postJson(`${cloudBaseUrl}/__e2e/confirm-latest-primary-host`);
  try {
    await waitFor(async () => {
      const current = await body(page);
      if (current.includes('\u6838\u9a8c\u672c\u673a\u5e76\u542f\u7528\u4e3b\u673a\u8eab\u4efd')) return true;
      await clickText(page, '\u6211\u5df2\u5728\u5fae\u4fe1\u5b8c\u6210\uff0c\u5237\u65b0\u72b6\u6001');
      await sleep(700);
      return (await body(page)).includes('\u6838\u9a8c\u672c\u673a\u5e76\u542f\u7528\u4e3b\u673a\u8eab\u4efd') || null;
    }, 'HOST_AUTHORITY_BOOTSTRAP_READY_REQUIRED');
  } catch (cause) {
    const rendered = (await body(page)).replace(/\s+/g, ' ').slice(0, 1600);
    const state = await fetch(`${cloudBaseUrl}/__e2e/state`).then(response => response.json()).catch(() => null);
    throw Object.assign(new Error(`${cause.code || cause.message} PAGE=${rendered} STATE=${JSON.stringify(state).slice(0, 1600)}`), { code: cause.code || 'HOST_AUTHORITY_BOOTSTRAP_READY_REQUIRED' });
  }
  await fillByPlaceholder(page, '\u8f93\u5165\u8fd9\u53f0\u7535\u8111\u7684\u672c\u673a\u5bc6\u7801', HOST_PASSWORD);
  await clickTextWhenAvailable(page, '\u6838\u9a8c\u672c\u673a\u5e76\u542f\u7528\u4e3b\u673a\u8eab\u4efd', 'HOST_AUTHORITY_BOOTSTRAP_COMPLETE_REQUIRED');
  await waitBody(page, '\u663e\u793a\u4e00\u6b21\u6027\u6062\u590d\u5305', 'HOST_RECOVERY_DELIVERY_REQUIRED');
  await waitFor(async () => {
    if ((await body(page)).includes('\u6211\u5df2\u79bb\u7ebf\u4fdd\u5b58\uff0c\u786e\u8ba4\u4ea4\u4ed8\u5e76\u91cd\u542f')) return true;
    try {
      await clickText(page, '\u663e\u793a\u4e00\u6b21\u6027\u6062\u590d\u5305');
    } catch (error) {
      if (error?.code !== 'REAL_DESKTOP_UI_ACTION_MISSING') throw error;
    }
    await sleep(500);
    return (await body(page)).includes('\u6211\u5df2\u79bb\u7ebf\u4fdd\u5b58\uff0c\u786e\u8ba4\u4ea4\u4ed8\u5e76\u91cd\u542f') || null;
  }, 'HOST_RECOVERY_REVEAL_REQUIRED');
  try {
    await waitBody(page, '\u786e\u8ba4\u4ea4\u4ed8\u5e76\u91cd\u542f', 'HOST_RECOVERY_ACKNOWLEDGE_REQUIRED');
  } catch (cause) {
    const rendered = (await body(page)).replace(/\s+/g, ' ').slice(0, 1800);
    throw Object.assign(new Error(`${cause.code || cause.message} PAGE=${rendered}`), {
      code: cause.code || 'HOST_RECOVERY_ACKNOWLEDGE_REQUIRED',
    });
  }
  await clickTextWhenAvailable(page, '\u6211\u5df2\u79bb\u7ebf\u4fdd\u5b58\uff0c\u786e\u8ba4\u4ea4\u4ed8\u5e76\u91cd\u542f', 'HOST_RECOVERY_RESTART_REQUIRED');
  await waitFor(() => (hostProcess?.exitCode !== null || hostProcess?.killed === true) ? true : null,
    'HOST_AUTHORITY_RESTART_EXIT_REQUIRED', 45_000);
  await stopProfile(HOST_ROOT, hostProcess);
  await waitFor(() => canBindLoopbackPort(hostPort), 'HOST_AUTHORITY_RESTART_PORT_RELEASE_REQUIRED', 45_000);
  const relaunchedHost = startDesktop(HOST_EXE, HOST_ROOT, hostPort, hostCdpPort, acceptance);
  await waitFor(async () => {
    const probe = await connectRealDesktopPage({ cdpPort: hostCdpPort, profileRoot: HOST_ROOT });
    await probe.close();
    return true;
  }, 'HOST_AUTHORITY_EXPLICIT_RELAUNCH_REQUIRED', 120_000);
  await waitFor(() => loopbackHealth(`http://127.0.0.1:${hostPort}/api/health`), 'HOST_AUTHORITY_RELAUNCH_BACKEND_REQUIRED', 150_000);
  await sleep(1200);
  const relaunched = actionPage(hostCdpPort, HOST_ROOT);
  const restartGate = await waitFor(async () => {
    const current = await body(relaunched);
    return current.includes('\u9a8c\u8bc1\u5e76\u8fdb\u5165') || current.includes('\u7cfb\u7edf\u4e0e\u6570\u636e') ? current : null;
  }, 'HOST_AUTHORITY_RELAUNCH_GATE_REQUIRED', 90_000);
  if (restartGate.includes('\u9a8c\u8bc1\u5e76\u8fdb\u5165')) {
    await fillByPlaceholder(relaunched, '\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801', HOST_PASSWORD);
    await clickText(relaunched, '\u9a8c\u8bc1\u5e76\u8fdb\u5165');
  }
  await waitBody(relaunched, '\u7cfb\u7edf\u4e0e\u6570\u636e', 'HOST_AUTHORITY_RELAUNCH_UI_REQUIRED', 90_000);
  await waitFor(async () => {
    const state = await relaunched.evaluate('window.primaryHostRuntime.workerStatus()');
    return state && state.running === true ? state : null;
  }, 'HOST_WORKER_STATUS_REQUIRED');
  return { page: relaunched, host: relaunchedHost };
}
async function beginClientIdentityRegistration(page) {
  const startLabel = '\u5f00\u59cb\u5fae\u4fe1\u8eab\u4efd\u6ce8\u518c';
  await waitBody(page, startLabel, 'CLIENT_IDENTITY_GATE_REQUIRED');
  await clickTextWhenAvailable(page, startLabel, 'CLIENT_IDENTITY_BEGIN_ACTION_REQUIRED');
  await waitFor(async () => {
    const current = await body(page);
    return /\b[0-9]{6}\b/.test(current) || current.includes('\u7b49\u5f85\u53e6\u4e00\u53f0\u5df2\u6388\u6743\u8bbe\u5907\u5ba1\u6838') ? current : null;
  }, 'CLIENT_IDENTITY_CHALLENGE_UI_REQUIRED');
}
async function approvePendingDeviceThroughHostUi(page) {
  await openHostIdentity(page);
  await waitBody(page, '\u5f85\u5ba1\u8bbe\u5907\u7533\u8bf7', 'HOST_PENDING_DEVICE_UI_REQUIRED');
  console.log('[e2e] host pending-device UI rendered');
  await waitFor(async () => {
    try {
      await clickText(page, '\u6279\u51c6');
      console.log('[e2e] host visible approve action clicked');
      return true;
    } catch (error) {
      if (error?.code !== 'REAL_DESKTOP_UI_ACTION_MISSING') throw error;
      await clickText(page, '\u5237\u65b0\u72b6\u6001');
      await sleep(700);
      return null;
    }
  }, 'HOST_DEVICE_APPROVE_ACTION_REQUIRED');
  await waitFor(async () => {
    const modalOpen = await page.evaluate(`(() => Array.from(document.querySelectorAll('.ant-modal-wrap')).some(item => { const style = window.getComputedStyle(item); const rect = item.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && (item.innerText || '').replace(/\\s+/g, '').includes('\u6279\u51c6\u6b64\u8bbe\u5907'); }))()`);
    if (!modalOpen) return true;
    try {
      await clickVisibleModalText(page, '\u6279\u51c6\u6b64\u8bbe\u5907');
      await sleep(700);
      return null;
    } catch (error) {
      if (error?.code === 'REAL_DESKTOP_VISIBLE_MODAL_ACTION_MISSING') return null;
      throw error;
    }
  }, 'HOST_DEVICE_APPROVE_MODAL_DISMISS_REQUIRED', 30_000);
  console.log('[e2e] host approve modal resolved');
  await waitBody(page, '\u8bbe\u5907\u7533\u8bf7\u5df2\u6279\u51c6', 'HOST_DEVICE_APPROVE_RESULT_REQUIRED');
  await waitBody(page, '\u5df2\u6279\u51c6\uff0c\u7b49\u5f85\u65b0\u8bbe\u5907\u5b8c\u6210\u8bbe\u7f6e', 'HOST_DEVICE_APPROVED_PENDING_STATUS_REQUIRED');
  console.log('[e2e] host device approval result rendered');
}
async function waitForExternalVisibleDeviceApproval(page, cloudBaseUrl) {
  console.log('[e2e] WAITING_FOR_EXTERNAL_VISIBLE_DEVICE_APPROVAL');
  await waitFor(async () => {
    const state = await fetch(`${cloudBaseUrl}/__e2e/state`)
      .then(response => response.json())
      .catch(() => null);
    const clientChallenges = state?.data?.challenges
      ?.filter(row => row.deviceId === 'real_e2e_two_app_client') || [];
    const latest = clientChallenges[clientChallenges.length - 1];
    return latest?.status === 'approved_pending_exchange' ? latest : null;
  }, 'HOST_EXTERNAL_APPROVAL_CONTROL_PLANE_REQUIRED', 180_000);
  await waitBody(
    page,
    '\u5df2\u6279\u51c6\uff0c\u7b49\u5f85\u65b0\u8bbe\u5907\u5b8c\u6210\u8bbe\u7f6e',
    'HOST_DEVICE_APPROVED_PENDING_STATUS_REQUIRED',
    30_000,
  );
  console.log('[e2e] external visible host approval observed');
}
async function completeClientIdentityRegistration(page) {
  await waitBody(page, '\u8bbe\u5907\u5ba1\u6838\u5df2\u901a\u8fc7', 'CLIENT_DEVICE_APPROVED_UI_REQUIRED');
  await fillByPlaceholder(page, '\u81f3\u5c11 6 \u4e2a\u5b57\u7b26', CLIENT_PASSWORD);
  await fillByPlaceholder(page, '\u518d\u6b21\u8f93\u5165\u672c\u673a\u5bc6\u7801', CLIENT_PASSWORD);
  await clickTextWhenAvailable(page, '\u4fdd\u5b58\u672c\u673a\u5bc6\u7801\u5e76\u8fdb\u5165', 'CLIENT_LOCAL_PASSWORD_SUBMIT_REQUIRED');
  await waitBody(page, '\u9501\u5b9a', 'CLIENT_IDENTITY_UNLOCK_UI_REQUIRED');
}
async function unlockClientForAuthorityCommand(page) {
  const readState = () => page.evaluate(`(() => ({
    locked: Boolean(document.querySelector('[placeholder="\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801"]')),
    authority: Boolean(window.desktopAuthority?.appendDraft),
    hasRuntimeShell: Boolean(document.querySelector('.app-shell__collapse-button')),
  }))()`);
  await waitFor(async () => {
    const state = await readState();
    return state.locked || state.authority || state.hasRuntimeShell ? state : null;
  }, 'CLIENT_AUTHORITY_UNLOCK_GATE_REQUIRED');
  let finalState = await readState();
  for (let attempt = 0; attempt < 3 && !finalState.hasRuntimeShell; attempt += 1) {
    if (finalState.locked) {
      await fillByPlaceholder(page, '\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801', CLIENT_PASSWORD);
      await clickTextWhenAvailable(page, '\u9a8c\u8bc1\u5e76\u8fdb\u5165', 'CLIENT_AUTHORITY_UNLOCK_ACTION_REQUIRED');
    }
    try {
      finalState = await waitFor(async () => {
        const state = await readState();
        return state.hasRuntimeShell && !state.locked && state.authority ? state : null;
      }, 'CLIENT_AUTHORITY_RUNTIME_SHELL_REQUIRED', 25_000);
    } catch (_notReady) {
      finalState = await readState();
    }
  }
  if (!(finalState.hasRuntimeShell && !finalState.locked && finalState.authority)) {
    throw Object.assign(new Error(`CLIENT_AUTHORITY_UNLOCK_COMPLETED_REQUIRED STATE=${JSON.stringify(finalState)}`), {
      code: 'CLIENT_AUTHORITY_UNLOCK_COMPLETED_REQUIRED',
    });
  }
}
async function ensureAuthorityOutboxUi(page) {
  const outboxTitle = '\u6743\u5a01\u6570\u636e\u4e3b\u673a\u540c\u6b65';
  if (!(await body(page)).includes(outboxTitle)) {
    const advancedSyncLabel = String.fromCodePoint(25968, 25454, 21516, 27493, 65306, 39640, 32423, 25805, 20316, 19982, 31995, 32479, 35814, 24773);
    await clickTextWhenAvailable(page, advancedSyncLabel, 'HOST_AUTHORITY_OUTBOX_EXPAND_REQUIRED');
  }
  await waitBody(page, outboxTitle, 'CLIENT_AUTHORITY_OUTBOX_UI_REQUIRED');
}
async function appendOfflineDraft(page) {
  await page.networkOffline();
  const draftAttempt = await page.evaluate(`(async () => {
    try {
      return { ok: true, value: window.desktopAuthority.appendDraftSync({
        type: 'personal-asset-account.create.v1',
        payload: {
          accountType: 'custom', provider: 'isolated-e2e', label: 'isolated offline acceptance',
          maskedIdentifier: 'E2E-OFFLINE-ONLY', balance: 0, currency: 'CNY',
        },
        preview: { fixture: 'isolated-offline' },
      }) };
    } catch (error) {
      return { ok: false, code: String(error?.code || ''), message: String(error?.message || '') };
    }
  })()`);
  assert.strictEqual(draftAttempt?.ok, true, `OFFLINE_DRAFT_CREATE_REQUIRED ${draftAttempt?.code || draftAttempt?.message || 'UNKNOWN'}`);
  const draft = draftAttempt.value;
  assert(draft?.id, 'OFFLINE_DRAFT_CREATE_REQUIRED');
  const pending = await page.evaluate(`(async () => window.desktopAuthority.get(${literal(draft.id)}))()`);
  assert.strictEqual(pending?.status, 'awaiting_confirmation', 'OFFLINE_DRAFT_AWAITING_CONFIRMATION_REQUIRED');
  assert.strictEqual(pending?.submission, null, 'OFFLINE_DRAFT_NETWORK_SUBMISSION_FORBIDDEN');
  await page.networkOnline();
  const restored = await page.evaluate(`(() => navigator.onLine === true)()`);
  assert.strictEqual(restored, true, 'OFFLINE_DRAFT_NETWORK_RESTORE_REQUIRED');
  return draft;
}
async function restartClientForOfflineDraft(client, clientPort, clientCdp, acceptance) {
  await stopProfile(CLIENT_ROOT, client);
  await waitFor(() => (client?.exitCode !== null || client?.killed === true) ? true : null,
    'CLIENT_OFFLINE_DRAFT_PROCESS_STOPPED_REQUIRED', 30_000);
  await waitFor(async () => {
    return !(await loopbackHealth(`http://127.0.0.1:${clientPort}/api/health`));
  }, 'CLIENT_OFFLINE_DRAFT_STOP_REQUIRED', 30_000);
  await waitFor(() => canBindLoopbackPort(clientPort), 'CLIENT_OFFLINE_DRAFT_PROFILE_RELEASE_REQUIRED', 30_000);
  const relaunched = startDesktop(CLIENT_EXE, CLIENT_ROOT, clientPort, clientCdp, acceptance);
  await waitFor(() => loopbackHealth(`http://127.0.0.1:${clientPort}/api/health`), 'CLIENT_OFFLINE_DRAFT_RESTART_REQUIRED', 90_000);
  await waitFor(async () => {
    const probe = await connectRealDesktopPage({ cdpPort: clientCdp, profileRoot: CLIENT_ROOT });
    await probe.close();
    return true;
  }, 'CLIENT_OFFLINE_DRAFT_RENDERER_REQUIRED', 45_000);
  return { client: relaunched, page: actionPage(clientCdp, CLIENT_ROOT) };
}
async function submitHarmlessLanCommandThroughUi(page, expectedTransport = 'lan-websocket', draftInput = {
  type: 'personal-asset-account.create.v1',
  payload: {
    accountType: 'custom', provider: 'isolated-e2e', label: 'isolated LAN acceptance',
    maskedIdentifier: 'E2E-ONLY', balance: 0, currency: 'CNY',
  },
  preview: { fixture: 'isolated-lan' },
}, existingDraft = null) {
  const draftAttempt = existingDraft ? { ok: true, value: existingDraft } : await page.evaluate(`(async () => {
    try {
      return { ok: true, value: window.desktopAuthority.appendDraftSync(${literal(draftInput)}) };
    } catch (error) {
      return { ok: false, code: String(error?.code || ''), message: String(error?.message || '') };
    }
  })()`);
  assert.strictEqual(draftAttempt?.ok, true, `LAN_DRAFT_FIXTURE_REQUIRED ${draftAttempt?.code || draftAttempt?.message || 'UNKNOWN'}`);
  const draft = draftAttempt.value;
  assert(draft?.id, 'LAN_DRAFT_FIXTURE_REQUIRED');
  await ensurePinnedNavigation(page);
  await openMenuGroup(page, 'system-data', 'CLIENT_SYSTEM_DATA_NAVIGATION_REQUIRED');
  await openMenuItem(page, 'system-params', 'CLIENT_SYSTEM_PARAMS_ROUTE_REQUIRED');
  await releaseNavigationOverlay(page);
  await ensureAuthorityOutboxUi(page);
  await clickTextWhenAvailable(page, '\u5f71\u54cd\u9884\u89c8', 'LAN_DRAFT_PREVIEW_REQUIRED');
  await waitBody(page, '\u786e\u8ba4\u63d0\u4ea4\u5230\u6743\u5a01\u6570\u636e\u4e3b\u673a', 'LAN_DRAFT_CONFIRM_DIALOG_REQUIRED');
  await waitFor(async () => {
    try {
      await clickVisibleModalText(page, '\u786e\u8ba4\u5e76\u53d1\u9001');
      return true;
    } catch (error) {
      if (error?.code === 'REAL_DESKTOP_VISIBLE_MODAL_ACTION_MISSING') return null;
      throw error;
    }
  }, 'LAN_DRAFT_CONFIRM_BUTTON_REQUIRED', 30_000);
  let latestDraft = null;
  let latestUi = '';
  let submissionError = '';
  try {
    await waitFor(async () => {
      const read = await page.evaluate(`(async () => {
        try { return { ok: true, item: await window.desktopAuthority.get(${literal(draft.id)}) }; }
        catch (error) { return { ok: false, code: String(error?.code || ''), message: String(error?.message || '') }; }
      })()`);
      latestDraft = read;
      return read?.ok === true && latestDraft?.item?.status !== 'awaiting_confirmation'
        ? read.item
        : null;
    }, 'DRAFT_CONFIRMATION_NOT_OBSERVED', 15_000);
  } catch (cause) {
    latestUi = (await body(page)).replace(/\s+/g, ' ').slice(0, 2400);
    throw Object.assign(new Error(`DRAFT_CONFIRMATION_NOT_OBSERVED DRAFT=${JSON.stringify(latestDraft)} UI=${latestUi}`), {
      code: cause.code || 'DRAFT_CONFIRMATION_NOT_OBSERVED',
    });
  }
  let completed;
  try {
    completed = await waitFor(async () => {
      const read = await page.evaluate(`(async () => {
        try { return { ok: true, item: await window.desktopAuthority.get(${literal(draft.id)}) }; }
        catch (error) { return { ok: false, code: String(error?.code || ''), message: String(error?.message || '') }; }
      })()`);
      latestDraft = read;
      latestUi = (await body(page)).replace(/\s+/g, ' ').slice(0, 2400);
      const visibleError = await page.evaluate(`(() => Array.from(document.querySelectorAll('.ant-message-notice-content, .ant-notification-notice-message'))
        .map(item => (item.innerText || '').replace(/\s+/g, ' ').trim())
        .find(text => /AUTHORITY|HOST|DEVICE|LEASE|COMMAND/i.test(text)) || '')()`);
      if (visibleError) submissionError = visibleError;
      return read?.ok === true && read.item?.status === 'completed' ? read.item : null;
    }, 'LAN_DRAFT_RECEIPT_REQUIRED', 90_000);
  } catch (cause) {
    throw Object.assign(new Error(`${cause.code || cause.message} DRAFT=${JSON.stringify(latestDraft)} UI=${latestUi} SUBMISSION_ERROR=${submissionError || 'LAN_DRAFT_SUBMISSION_ERROR_REQUIRED'}`), {
      code: cause.code || 'LAN_DRAFT_RECEIPT_REQUIRED',
    });
  }
  assert.strictEqual(completed?.submission?.transportUsed, expectedTransport, 'LAN_TRANSPORT_REQUIRED');
  if (existingDraft) {
    assert.strictEqual(completed?.receipt?.commandId, completed?.submission?.commandId, 'OFFLINE_DRAFT_SINGLE_RECEIPT_REQUIRED');
    assert.strictEqual(completed?.receipt?.status, 'committed', 'OFFLINE_DRAFT_SINGLE_RECEIPT_REQUIRED');
  }
  return completed;
}
async function writeHarmlessHostBusinessRecord(hostPage, note) {
  const result = await hostPage.evaluate(`(async () => {
    try {
      if (!window.primaryHostRuntime?.executeLocalDraft) {
        return { ok: false, code: 'HOST_LOCAL_AUTHORITY_WRITE_REQUIRED' };
      }
      const recordId = 'isolated-host-reverse-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      const result = await window.primaryHostRuntime.executeLocalDraft({
        type: 'personal-asset-record.create.v1',
        payload: {
          record: {
            id: recordId,
            date: '2026-07-29',
            type: 'expense',
            amount: 0,
            note: ${literal(note)},
          },
        },
      });
      if (result?.receipt?.status !== 'committed') {
        return { ok: false, code: result?.receipt?.error?.code || 'HOST_LOCAL_AUTHORITY_COMMAND_REJECTED', receipt: result?.receipt || null };
      }
      return { ok: true, receipt: result.receipt };
    } catch (error) {
      return { ok: false, code: String(error?.code || ''), message: String(error?.message || '') };
    }
  })()`);
  assert.strictEqual(result?.ok, true, `HOST_LOCAL_AUTHORITY_WRITE_REQUIRED ${result?.code || result?.message || 'UNKNOWN'}`);
  return Number(result?.receipt?.projectionVersion || 0);
}
async function verifyHostReverseProjection(clientPage, recordNote, minSourceVersion = 0) {
  let lastProbe = null;
  let lastEvaluationError = '';
  try {
    await waitFor(async () => {
      try {
        const result = await clientPage.evaluate(`(async () => {
          try {
            await window.dbService.refreshAuthorityProjection({ minSourceVersion: Number(${literal(minSourceVersion)} || 0) });
            const records = window.dbService.getAllAssetRecords();
            return { ok: true, found: records.some(item => item.note === ${literal(recordNote)}), recordCount: records.length };
          } catch (error) {
            return { ok: false, code: String(error?.code || ''), message: String(error?.message || '') };
          }
        })()`);
        lastProbe = result;
        return result?.ok === true && result.found === true ? result : null;
      } catch (error) {
        lastEvaluationError = String(error?.message || error || 'REAL_DESKTOP_CDP_ACTION_FAILED');
        throw error;
      }
    }, 'HOST_REVERSE_PROJECTION_REQUIRED', 90_000);
  } catch (cause) {
    throw Object.assign(new Error(`${cause.code || cause.message} HOST_REVERSE_PROJECTION_DIAGNOSTIC LAST_PROBE=${JSON.stringify(lastProbe)} LAST_EVALUATION_ERROR=${lastEvaluationError || 'NONE'}`), {
      code: cause.code || 'HOST_REVERSE_PROJECTION_REQUIRED',
    });
  }
}
function packagedColdStartTimeoutMs() {
  const configured = Number(process.env.GEWU_PACKAGED_COLD_START_TIMEOUT_MS || 150_000);
  return Number.isFinite(configured) ? Math.max(45_000, Math.min(configured, 180_000)) : 150_000;
}
function configuredLanHostPort() {
  const configured = String(process.env.GEWU_LAN_E2E_HOST_PORT || '').trim();
  if (!configured) return null;
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1 || value > 65535) fail('LAN_E2E_HOST_PORT_REQUIRED');
  return value;
}
function fixedLanHostPort() { return configuredLanHostPort() || 60462; }
function usesIsolatedTemporaryHostPackage(executablePath) {
  const normalized = path.resolve(String(executablePath || '')).replace(/\\/g, '/').toLowerCase();
  return /\/tmp-e2e-host-cutover-[a-z0-9-]+\/win-unpacked\/[^/]+\.exe$/.test(normalized);
}
async function runAcceptance(acceptance) {
  assert(HOST_EXE && fs.existsSync(HOST_EXE), 'GEWU_PACKAGED_HOST_EXE_REQUIRED');
  assert(CLIENT_EXE && fs.existsSync(CLIENT_EXE), 'GEWU_PACKAGED_CLIENT_EXE_REQUIRED');
  const coldStartTimeoutMs = packagedColdStartTimeoutMs();
  const hostPort = configuredLanHostPort() || await freePort(); const isolatedLanPort = acceptance.relayWebSocket ? await freePort() : null; const clientPort = await freePort(); const hostCdp = await freePort(); const clientCdp = await freePort(); const cloudPort = await freePort();
  // This is intentionally audit-only. Only an explicit LAN row needs an
  // installed-host rule; relay-only rows must remain usable without one.
  // Tests never request Windows elevation.
  const requiresLanFirewallAudit = !acceptance.websocketDisabled && !acceptance.relayWebSocket;
  const firewallAudit = requiresLanFirewallAudit && !usesIsolatedTemporaryHostPackage(HOST_EXE)
    ? runLanE2ePreflight({
      hostExe: HOST_EXE,
      hostPort,
      helperPath: path.join(path.dirname(HOST_EXE), 'resources', 'app', 'public', 'windowsHostFirewallElevated.ps1'),
      clientBackendUrl: `http://127.0.0.1:${clientPort}`,
    })
    : (requiresLanFirewallAudit ? { localPort: hostPort, testOnly: true } : null);
  console.log(firewallAudit
    ? (firewallAudit.testOnly
      ? `[e2e] TEMPORARY_PACKAGE_FIREWALL_AUDIT_BYPASSED port ${firewallAudit.localPort}`
      : `[e2e] LAN firewall preflight enabled for port ${firewallAudit.localPort}`)
    : '[e2e] LAN firewall preflight skipped for relay-only acceptance');
  let cloud = null; let host = null; let client = null; let hostPage = null; let clientPage = null;
  try {
    cloud = startIdentityCloud({ port: cloudPort });
    await waitFor(async () => {
      try {
        await assertAuthorityControlPlane(cloud.baseUrl);
        return true;
      } catch (_error) {
        return null;
      }
    }, 'AUTHORITY_CONTROL_PLANE_READY_REQUIRED', 150_000);
    prepareHost({ backendPort: hostPort, cloudBaseUrl: cloud.baseUrl });
    const cutover = authorizeIsolatedCutoverFixture();
    assert.strictEqual(cutover.legacyRoutesSafeToRemove, true, 'ISOLATED_CUTOVER_REHEARSAL_REQUIRED');
    prepareClient({
      hostBaseUrl: acceptance.relayWebSocket
        ? `http://127.0.0.1:${isolatedLanPort}`
        : `http://${lanAddress()}:${hostPort}`,
      cloudBaseUrl: cloud.baseUrl,
    });
    host = startDesktop(HOST_EXE, HOST_ROOT, hostPort, hostCdp, acceptance);
    console.log(`[e2e] waiting for packaged host cold start (timeout=${coldStartTimeoutMs}ms)`);
    await waitFor(() => loopbackHealth(`http://127.0.0.1:${hostPort}/api/health`), 'HOST_BACKEND_HEALTH_REQUIRED', coldStartTimeoutMs);
    assertCurrentProcessBudget();
    console.log('[e2e] host backend healthy');
    await waitFor(async () => {
      const probe = await connectRealDesktopPage({ cdpPort: hostCdp, profileRoot: HOST_ROOT });
      await probe.close();
      return true;
    }, 'HOST_RENDERER_REQUIRED');
    hostPage = actionPage(hostCdp, HOST_ROOT);
    console.log('[e2e] host renderer attached');
    const unlockedHost = await initializeHost(hostPage, hostPort, hostCdp, cloud.baseUrl);
    await hostPage.close().catch(() => {}); hostPage = unlockedHost;
    const bootstrappedHost = await bootstrapHostAuthorityThroughUi(hostPage, hostPort, hostCdp, cloud.baseUrl, host, acceptance);
    await hostPage.close().catch(() => {}); hostPage = bootstrappedHost.page; host = bootstrappedHost.host;
    client = startDesktop(CLIENT_EXE, CLIENT_ROOT, clientPort, clientCdp, acceptance);
    await waitFor(() => loopbackHealth(`http://127.0.0.1:${clientPort}/api/health`), 'CLIENT_BACKEND_HEALTH_REQUIRED');
    assertCurrentProcessBudget();
    console.log('[e2e] client backend healthy');
    await waitFor(async () => {
      const probe = await connectRealDesktopPage({ cdpPort: clientCdp, profileRoot: CLIENT_ROOT });
      await probe.close();
      return true;
    }, 'CLIENT_RENDERER_REQUIRED');
    clientPage = actionPage(clientCdp, CLIENT_ROOT);
    console.log('[e2e] client renderer attached');
    activateDesktopWindow(client, 'CLIENT_WINDOW_ACTIVATION_REQUIRED');
    await sleep(500);
    await beginClientIdentityRegistration(clientPage);
    await postJson(`${cloud.baseUrl}/__e2e/confirm-latest`);
    try {
      await hostPage.close().catch(() => {});
      hostPage = actionPage(hostCdp, HOST_ROOT);
      activateDesktopWindow(host, 'HOST_WINDOW_ACTIVATION_REQUIRED');
      await sleep(500);
      console.log('[e2e] host renderer refreshed before visible device approval');
      if (EXTERNAL_VISIBLE_APPROVAL) {
        await waitForExternalVisibleDeviceApproval(hostPage, cloud.baseUrl);
      } else {
        await approvePendingDeviceThroughHostUi(hostPage);
      }
    } catch (cause) {
      const state = await fetch(`${cloud.baseUrl}/__e2e/state`).then(response => response.json()).catch(() => null);
      let rendered = ''; let menuState = null; let diagnosticFailure = '';
      const causeDetail = String(cause?.message || cause?.code || 'UNKNOWN').replace(/\s+/g, ' ').slice(0, 2400);
      try {
        rendered = (await body(hostPage)).replace(/\s+/g, ' ').slice(0, 1800);
        menuState = await hostPage.evaluate(`(() => {
          const item = document.querySelector('[data-menu-id$="-identity-devices"]');
          const sider = document.querySelector('.app-shell__sider');
          const content = document.querySelector('.app-shell__content');
          return {
            itemClass: item?.className || null,
            itemExpanded: item?.getAttribute('aria-expanded') || null,
            itemRect: item ? (() => { const rect = item.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; })() : null,
            siderClass: sider?.className || null,
            siderRight: sider?.getBoundingClientRect().right || null,
            contentPage: content?.className || null,
          };
        })()`);
      } catch (diagnosticError) {
        diagnosticFailure = `HOST_DEVICE_APPROVE_DIAGNOSTIC_FAILED:${diagnosticError?.code || diagnosticError?.message || 'UNKNOWN'}`;
      }
      throw Object.assign(new Error(`${cause.code || cause.message} CAUSE_DETAIL=${causeDetail} HOST_PAGE=${rendered} MENU_STATE=${JSON.stringify(menuState)} CONTROL_PLANE=${JSON.stringify(state).slice(0, 1800)} ${diagnosticFailure}`), { code: cause.code || 'HOST_DEVICE_APPROVE_ACTION_REQUIRED' });
    }
    activateDesktopWindow(client, 'CLIENT_WINDOW_ACTIVATION_REQUIRED');
    await sleep(500);
    await completeClientIdentityRegistration(clientPage);
    console.log('[e2e] client local identity registration completed');
    await unlockClientForAuthorityCommand(clientPage);
    console.log('[e2e] client initial runtime shell unlocked');
    const offlineDraft = await appendOfflineDraft(clientPage);
    console.log('[e2e] offline draft sealed without submission; renderer network restored');
    const restartedClient = await restartClientForOfflineDraft(client, clientPort, clientCdp, acceptance);
    console.log('[e2e] client process restarted after offline draft');
    client = restartedClient.client;
    clientPage = restartedClient.page;
    await unlockClientForAuthorityCommand(clientPage);
    console.log('[e2e] client restarted runtime shell unlocked');
    try {
      await waitBody(clientPage, '\u7cfb\u7edf\u4e0e\u6570\u636e', 'CLIENT_OFFLINE_DRAFT_MAIN_UI_REQUIRED', 60_000);
    } catch (cause) {
      const diagnostic = await clientPage.evaluate(`(() => ({
        page: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1800),
        hasAuthorityBridge: Boolean(window.desktopAuthority?.appendDraft),
        hasMainShell: Boolean(document.querySelector('.app-shell')),
        hasLockInput: Boolean(document.querySelector('[placeholder="\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801"]')),
        currentRoute: location.hash || location.pathname,
      }))()`);
      throw Object.assign(new Error(`${cause.code || cause.message} CLIENT_OFFLINE_DRAFT_MAIN_UI_DIAGNOSTIC=${JSON.stringify(diagnostic)}`), {
        code: cause.code || 'CLIENT_OFFLINE_DRAFT_MAIN_UI_REQUIRED',
      });
    }
    const restartedOfflineDraft = await clientPage.evaluate(`(async () => window.desktopAuthority.get(${literal(offlineDraft.id)}))()`);
    assert.strictEqual(restartedOfflineDraft?.status, 'awaiting_confirmation', 'OFFLINE_DRAFT_RESTART_STATE_REQUIRED');
    assert.strictEqual(restartedOfflineDraft?.submission, null, 'OFFLINE_DRAFT_RESTART_STATE_REQUIRED');
    console.log('[e2e] offline draft survived restart without submission');
    if (acceptance.relayWebSocket) {
      await assertLanIsolated(`http://127.0.0.1:${isolatedLanPort}`);
    } else if (!acceptance.websocketDisabled) {
      await probeAuthoritySocket(`http://${lanAddress()}:${hostPort}`);
    }
    await submitHarmlessLanCommandThroughUi(
      clientPage,
      acceptance.websocketDisabled ? 'durable-relay' : (acceptance.relayWebSocket ? 'relay-websocket' : 'lan-websocket'),
      undefined,
      offlineDraft,
    );
    await submitHarmlessLanCommandThroughUi(
      clientPage,
      acceptance.websocketDisabled ? 'durable-relay' : (acceptance.relayWebSocket ? 'relay-websocket' : 'lan-websocket'),
    );
    const reverseRecordNote = 'isolated host reverse projection acceptance';
    const reverseProjectionVersion = await writeHarmlessHostBusinessRecord(hostPage, reverseRecordNote);
    await verifyHostReverseProjection(clientPage, reverseRecordNote, reverseProjectionVersion);
    const identityState = await (await fetch(`${cloud.baseUrl}/__e2e/state`)).json();
    const clientAuthorization = identityState?.data?.authorizations
      ?.find(row => row.deviceId === 'real_e2e_two_app_client');
    assert.strictEqual(clientAuthorization?.status, 'active', 'CLIENT_ACTIVATION_NOT_FINALIZED');
    const worker = await waitFor(async () => {
      const state = await hostPage.evaluate('window.primaryHostRuntime.workerStatus()');
      return state?.running === true ? state : null;
    }, 'HOST_WORKER_NOT_RUNNING');
    assert(worker.running === true, 'HOST_WORKER_NOT_RUNNING');
    assert(worker.wakeCount > 0, 'CLOUD_WORKER_WAKE_NOT_OBSERVED');
    console.log(JSON.stringify({ success: true, transport: 'managed-identity-lan-cloud-relay', websocketDisabled: acceptance.websocketDisabled, relayWebSocket: acceptance.relayWebSocket, isolatedCutoverMarker: true, deviceApprovedThroughVisibleHostUi: true, hostWorkerObserved: true, activationFinalized: true }));
  } finally {
    await clientPage?.close().catch(() => {}); await hostPage?.close().catch(() => {});
    const clientStopped = await stopProfile(CLIENT_ROOT, client);
    const hostStopped = await stopProfile(HOST_ROOT, host);
    if (cloud?.child?.pid) {
      try { childProcess.execFileSync('taskkill', ['/PID', String(cloud.child.pid), '/F'], { stdio: 'ignore' }); } catch (_error) { /* isolated control plane already exited */ }
    }
    if (process.env.GEWU_KEEP_REAL_TWO_DESKTOP_PROFILES === '1') console.log(`preserved disposable profiles: ${ROOT}`);
    else if (!clientStopped || !hostStopped) {
      console.error(`[e2e] TEMPORARY_PROFILE_CLEANUP_DEFERRED root=${ROOT} code=LIVE_PROCESSES`);
    }
    else {
      try {
        fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 });
      } catch (cleanupError) {
        // Do not replace the authority/LAN assertion that caused the run to fail.
        // The caller can remove this exact marked temporary root once Windows releases it.
        console.error(`[e2e] TEMPORARY_PROFILE_CLEANUP_DEFERRED root=${ROOT} code=${cleanupError?.code || 'UNKNOWN'}`);
      }
    }
  }
}

async function main() {
  const acceptance = assertRequiredAcceptanceFlags();
  const lease = acquireRunLease({ lockPath: RUN_LOCK_PATH });
  let processGuardian = null;
  try {
    assertPackagedDesktopProcessBudget(listLiveDisposableDesktopProcesses(), {
      activeRoot: '',
      maxProcesses: MAX_PACKAGED_DESKTOP_PROCESSES,
    });
    initializeDisposableRoots();
    processGuardian = startProcessGuardian(ROOT, RUN_LOCK_PATH);
    return await runAcceptance(acceptance);
  } finally {
    await stopProcessGuardian(processGuardian);
    lease.release();
  }
}

if (['--help', '-h'].includes(process.argv[2])) {
  showUsage();
} else {
  main().catch(error => { console.error(error.stack || error.message || error.code || error); process.exitCode = 1; });
}
