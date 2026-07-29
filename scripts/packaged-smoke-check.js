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
const embeddedBackendRuntimeFiles = ['shared/cloudRelayLogic.js'];
const hostOnlyRuntimeFiles = [
  'public/primaryHostCredentialStore.js',
  'public/primaryHostOperationValidation.js',
  'public/primaryHostRuntimeManager.js',
];

function verifyPackagedFlavorBoundary() {
  const metadataPath = path.join(packagedAppRoot, 'package.json');
  const shellPolicyPath = path.join(packagedAppRoot, 'public', 'electronShellPolicy.js');
  if (!fs.existsSync(metadataPath) || !fs.existsSync(shellPolicyPath)) {
    throw new Error('Packaged flavor metadata or Electron shell policy is missing');
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const flavor = metadata.desktopBuildFlavor === 'primary-host' ? 'primary-host' : 'desktop-client';
  const presentHostFiles = hostOnlyRuntimeFiles.filter(file => fs.existsSync(path.join(packagedAppRoot, ...file.split('/'))));
  if (flavor === 'desktop-client' && presentHostFiles.length > 0) {
    throw new Error(`Ordinary package contains host-only runtime files: ${presentHostFiles.join(', ')}`);
  }
  if (flavor === 'primary-host' && presentHostFiles.length !== hostOnlyRuntimeFiles.length) {
    throw new Error('Primary-host package is missing host-only runtime files');
  }
  return flavor;
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

function stopProcessTree(pid) {
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (_) {
    // The process may already have exited.
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

    if (state.rootLength <= 0 || state.bodyLength <= 0 || blockingMessages.length > 0) {
      throw new Error(`Packaged app smoke failed: ${JSON.stringify({ state, blockingMessages }, null, 2)}`);
    }

    console.log(`packaged smoke passed: flavor=${packagedFlavor} ${state.title} ${state.url}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stopProcessTree(child.pid);
    await waitForProcessExit(child);
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

module.exports = { verifyPackagedFlavorBoundary };
