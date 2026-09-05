const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { chromium } = require('playwright');

const productExe = process.env.PACKAGED_EXE || path.join(process.cwd(), 'dist', 'win-unpacked', '格物工坊.exe');
const debugPort = Number(process.env.PACKAGED_DEBUG_PORT || 9333);
const debugUrl = `http://127.0.0.1:${debugPort}`;
const packagedAppRoot = path.join(path.dirname(productExe), 'resources', 'app');
const embeddedBackendDependencies = ['fflate', 'katex', 'mathjax-full', 'pdfkit', 'sharp', 'svg-to-pdfkit', 'ws'];
const embeddedBackendRuntimeFiles = ['shared/authorityProtocol.js'];
const hostOnlyRuntimeFiles = [
  'public/primaryHostCredentialStore.js',
  'public/primaryHostOperationValidation.js',
  'public/primaryHostRuntimeManager.js',
];
const retiredRuntimeFiles = [
  'backend/src/routes/cloudRelay.js',
  'backend/src/services/cloudRelayTaskService.js',
  'backend/src/services/primaryHostIdentityService.js',
  'shared/cloudRelayLogic.js',
  'shared/primaryHostSigningKey.js',
];

function verifyPackagedFlavorBoundary() {
  const metadataPath = path.join(packagedAppRoot, 'package.json');
  const shellPolicyPath = path.join(packagedAppRoot, 'public', 'electronShellPolicy.js');
  if (!fs.existsSync(metadataPath) || !fs.existsSync(shellPolicyPath)) {
    throw new Error('Packaged flavor metadata or Electron shell policy is missing');
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const flavor = metadata.desktopBuildFlavor === 'primary-host' ? 'primary-host' : 'desktop-client';
  const presentRetiredRuntimeFiles = retiredRuntimeFiles.filter(file => fs.existsSync(path.join(packagedAppRoot, ...file.split('/'))));
  if (presentRetiredRuntimeFiles.length > 0) {
    throw new Error(`Package contains retired relay or primary-host runtime files: ${presentRetiredRuntimeFiles.join(', ')}`);
  }
  const presentHostFiles = hostOnlyRuntimeFiles.filter(file => fs.existsSync(path.join(packagedAppRoot, ...file.split('/'))));
  if (flavor === 'desktop-client' && presentHostFiles.length > 0) {
    throw new Error(`Ordinary package contains host-only runtime files: ${presentHostFiles.join(', ')}`);
  }
  if (flavor === 'primary-host' && presentHostFiles.length !== hostOnlyRuntimeFiles.length) {
    throw new Error('Primary-host package is missing host-only runtime files');
  }
  return flavor;
}

function verifyPackagedRendererBundle() {
  const rendererEntry = path.join(packagedAppRoot, 'build', 'index.html');
  if (!fs.existsSync(rendererEntry)) {
    throw new Error(`Packaged renderer entry is missing: ${rendererEntry}`);
  }
  return rendererEntry;
}

function assertNoLegacyIdentityFailure(state) {
  if (String(state?.bodyText || '').includes('身份验证未完成')) {
    throw new Error('Packaged app shows the retired generic identity-verification failure in a fresh profile');
  }
}

function verifyPackagedNativeAbi() {
  const electronExe = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
  const nativeModule = path.join(packagedAppRoot, 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(electronExe)) {
    throw new Error(`Electron runtime for packaged native ABI verification is missing: ${electronExe}`);
  }
  if (!fs.existsSync(nativeModule)) {
    throw new Error(`Packaged native database module is missing: ${nativeModule}`);
  }
  const script = [
    'const Database = require(process.argv[1]);',
    "const db = new Database(':memory:');",
    "try { db.prepare('SELECT 1 AS ok').get(); } finally { db.close(); }",
  ].join(' ');
  try {
    execFileSync(electronExe, ['-e', script, nativeModule], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(`Packaged native ABI verification failed: ${detail}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDebugPort(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${debugUrl}/json/version`);
      if (response.ok) return;
    } catch (_) {
      // Keep polling until Electron exposes the debugging endpoint.
    }
    await sleep(500);
  }
  throw new Error(`Packaged app debug port did not open: ${debugUrl}`);
}

function stopExactProcess(pid) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
  } catch (_) {
    // The process may already have exited.
  }
}

function findUserDataProcessIds(userDataDir, executableName = path.basename(productExe)) {
  const quotedUserDataDir = String(userDataDir).replace(/'/g, "''");
  const quotedExecutableName = String(executableName).replace(/'/g, "''");
  const script = [
    `$userDataDir = '${quotedUserDataDir}'`,
    `$executableName = '${quotedExecutableName}'`,
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $_.Name -eq $executableName -and $_.CommandLine -and $_.CommandLine.IndexOf($userDataDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
    '} | ForEach-Object { $_.ProcessId }',
  ].join('; ');
  try {
    return String(execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }))
      .split(/\r?\n/)
      .map(value => Number(value.trim()))
      .filter(Number.isInteger)
      .filter(pid => pid > 0);
  } catch (_) {
    return [];
  }
}

async function stopUserDataProcesses(userDataDir) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pids = findUserDataProcessIds(userDataDir);
    if (pids.length === 0) return;
    pids.forEach(stopExactProcess);
    await sleep(250);
  }
  const remaining = findUserDataProcessIds(userDataDir);
  if (remaining.length > 0) {
    throw new Error(`Packaged smoke cleanup left exact user-data processes: ${remaining.join(', ')}`);
  }
}

async function waitForProcessExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  if (!fs.existsSync(productExe)) {
    throw new Error(`Packaged executable not found: ${productExe}`);
  }
  const packagedFlavor = verifyPackagedFlavorBoundary();
  verifyPackagedRendererBundle();
  const missingDependencies = embeddedBackendDependencies.filter(dependency => (
    !fs.existsSync(path.join(packagedAppRoot, 'node_modules', dependency, 'package.json'))
  ));
  if (missingDependencies.length > 0) {
    throw new Error(`Packaged embedded backend dependencies are missing: ${missingDependencies.join(', ')}`);
  }
  const missingRuntimeFiles = embeddedBackendRuntimeFiles.filter(file => !fs.existsSync(path.join(packagedAppRoot, ...file.split('/'))));
  if (missingRuntimeFiles.length > 0) {
    throw new Error(`Packaged embedded backend runtime files are missing: ${missingRuntimeFiles.join(', ')}`);
  }
  verifyPackagedNativeAbi();

  const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-packaged-smoke-'));
  const child = spawn(productExe, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${isolatedUserDataDir}`,
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });

  let browser;
  try {
    await waitForDebugPort();
    browser = await chromium.connectOverCDP(debugUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    const page = pages[0];
    if (!page) throw new Error('Packaged app did not create a renderer page');

    const messages = [];
    page.on('console', message => messages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', error => messages.push({ type: 'pageerror', text: error.stack || error.message }));
    await page.waitForTimeout(2500);

    const state = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyLength: document.body.innerText.trim().length,
      rootLength: document.getElementById('root')?.innerHTML.trim().length || 0,
      bodyText: document.body.innerText.trim().slice(0, 300),
    }));

    const blockingMessages = messages.filter(message => (
      message.type === 'error' ||
      message.type === 'pageerror' ||
      /Uncaught|ReferenceError|TypeError|SyntaxError|module\.exports/i.test(message.text)
    ));

    assertNoLegacyIdentityFailure(state);
    if (state.rootLength <= 0 || state.bodyLength <= 0 || blockingMessages.length > 0) {
      throw new Error(`Packaged app smoke failed: ${JSON.stringify({ state, blockingMessages }, null, 2)}`);
    }

    console.log(`packaged smoke passed: flavor=${packagedFlavor} ${state.title} ${state.url}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stopExactProcess(child.pid);
    await waitForProcessExit(child);
    await stopUserDataProcesses(isolatedUserDataDir);
    await sleep(500);
    fs.rmSync(isolatedUserDataDir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});

module.exports = { verifyPackagedFlavorBoundary, verifyPackagedRendererBundle, verifyPackagedNativeAbi };
