'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const executable = path.resolve(String(process.env.GEWU_PACKAGED_EXE || ''));
const secondExecutableInput = String(process.env.GEWU_PACKAGED_SECOND_EXE || '').trim();
const secondExecutable = path.resolve(secondExecutableInput || executable);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-packaged-single-instance-'));

function packagedFlavor(executablePath) {
  const metadataPath = path.join(path.dirname(executablePath), 'resources', 'app', 'package.json');
  return JSON.parse(fs.readFileSync(metadataPath, 'utf8')).desktopBuildFlavor;
}

function prepareRuntimeConfig(flavor, backendPort) {
  assertDisposableRoot(root);
  const config = {
    nodeRole: flavor === 'primary-host' ? 'primary-host' : 'desktop-client',
    desktopIdentityMode: 'full',
    deviceId: `real_e2e_single_instance_${flavor.replace(/[^a-z0-9]+/g, '_')}`,
    primaryHostEpochId: '',
    primaryHostGeneration: null,
    hostBaseUrl: `http://127.0.0.1:${backendPort}`,
    cloudBaseUrl: 'http://127.0.0.1:9',
    managedCloudBaseUrl: 'http://127.0.0.1:9',
    mainDbPath: path.join(root, 'data', 'scheduling.db'),
    questionBankPath: '',
    questionAssetPath: '',
    questionBankCandidatePaths: [],
    questionBankStoreId: '',
    localCachePath: path.join(root, 'local-cache'),
    nasBackupPath: '',
  };
  fs.writeFileSync(path.join(root, 'gewugongfang.config.json'), JSON.stringify(config, null, 2), 'utf8');
  return config;
}

function assertDisposableRoot(value) {
  assert(path.basename(value).startsWith('tmp-packaged-single-instance-'), 'DISPOSABLE_PROFILE_REQUIRED');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(check, code, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (_error) { /* keep polling the exact disposable process */ }
    await sleep(250);
  }
  throw new Error(code);
}

function profileProcesses() {
  const escaped = root.replace(/'/g, "''");
  const command = [
    `$profile = '${escaped}'`,
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
    '} | ForEach-Object { "{0}`t{1}" -f $_.ProcessId,$_.CommandLine }',
  ].join('; ');
  try {
    return String(childProcess.execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const split = line.indexOf('\t');
        return { pid: Number(line.slice(0, split)), commandLine: line.slice(split + 1) };
      })
      .filter(row => Number.isInteger(row.pid) && row.pid > 0);
  } catch (_error) {
    return [];
  }
}

function browserProcesses() {
  return profileProcesses().filter(row => !/--type=/.test(row.commandLine));
}

function stopExactProfileProcesses() {
  assertDisposableRoot(root);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = profileProcesses();
    if (!rows.length) return;
    for (const { pid } of rows) {
      try {
        childProcess.execFileSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch (_error) { /* already stopped */ }
    }
  }
  if (profileProcesses().length) throw new Error('EXACT_PROFILE_PROCESS_CLEANUP_REQUIRED');
}

function waitForExit(child, timeoutMs = 15_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function main() {
  assertDisposableRoot(root);
  assert(fs.existsSync(executable) && path.extname(executable).toLowerCase() === '.exe', 'GEWU_PACKAGED_EXE_REQUIRED');
  assert(fs.existsSync(secondExecutable) && path.extname(secondExecutable).toLowerCase() === '.exe', 'SECOND_PACKAGED_EXE_REQUIRED');
  const firstExecutableRoot = path.normalize(path.dirname(executable)).toLowerCase();
  const secondExecutableRoot = path.normalize(path.dirname(secondExecutable)).toLowerCase();
  if (secondExecutableInput) {
    assert.notStrictEqual(secondExecutableRoot, firstExecutableRoot, 'SECOND_EXECUTABLE_ROOT_MUST_DIFFER');
  }
  const port = await freePort();
  const flavor = packagedFlavor(executable);
  const secondFlavor = packagedFlavor(secondExecutable);
  assert.strictEqual(secondFlavor, flavor, 'PACKAGED_FLAVOR_MISMATCH');
  prepareRuntimeConfig(flavor, port);
  const args = [`--user-data-dir=${root}`];
  const env = {
    ...process.env,
    PORT: String(port),
    GEWU_E2E_NO_AUTHORITY_DATA: '1',
    GEWU_E2E_MANAGED_CLOUD_BASE_URL: 'http://127.0.0.1:9',
  };
  const first = childProcess.spawn(executable, args, {
    cwd: path.dirname(executable), env, windowsHide: true, stdio: 'ignore',
  });
  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      return response.ok;
    }, 'FIRST_INSTANCE_BACKEND_REQUIRED', 120_000);
    const firstBrowser = await waitFor(() => {
      const rows = browserProcesses();
      return rows.length === 1 ? rows[0] : null;
    }, 'FIRST_INSTANCE_BROWSER_REQUIRED');

    const before = new Set(profileProcesses().map(row => row.pid));
    const second = childProcess.spawn(secondExecutable, args, {
      cwd: path.dirname(secondExecutable), env, windowsHide: true, stdio: 'ignore',
    });
    const secondExited = await waitForExit(second);
    if (!secondExited) {
      console.error(`SECOND_INSTANCE_DIAGNOSTIC ${JSON.stringify({
        secondPid: second.pid,
        secondExitCode: second.exitCode,
        secondSignalCode: second.signalCode,
        processes: profileProcesses(),
      })}`);
    }
    assert.strictEqual(secondExited, true, 'SECOND_INSTANCE_EXIT_REQUIRED');
    await sleep(1_000);
    const afterRows = profileProcesses();
    const afterBrowsers = afterRows.filter(row => !/--type=/.test(row.commandLine));
    assert.strictEqual(afterBrowsers.length, 1, 'SECOND_INSTANCE_PROCESS_LEAK');
    assert.strictEqual(afterBrowsers[0].pid, firstBrowser.pid, 'SECOND_INSTANCE_PROCESS_LEAK');
    assert.strictEqual(afterRows.some(row => row.pid === second.pid), false, 'SECOND_INSTANCE_PROCESS_LEAK');
    const unexpected = afterRows.filter(row => !before.has(row.pid));
    assert.deepStrictEqual(unexpected, [], 'SECOND_INSTANCE_PROCESS_LEAK');
    const health = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      return response.ok ? response : null;
    }, 'FIRST_INSTANCE_BACKEND_LOST');
    assert.strictEqual(health.ok, true, 'FIRST_INSTANCE_BACKEND_LOST');
    console.log(JSON.stringify({
      success: true,
      flavor,
      crossInstall: secondExecutableRoot !== firstExecutableRoot,
      secondInstanceExited: true,
      persistentBrowserProcesses: 1,
    }));
  } finally {
    stopExactProfileProcesses();
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
