const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { chromium } = require('playwright');

const productExe = process.env.PACKAGED_EXE || path.join(process.cwd(), 'dist', 'win-unpacked', '格物工坊.exe');
const debugPort = Number(process.env.PACKAGED_DEBUG_PORT || 9333);
const debugUrl = `http://127.0.0.1:${debugPort}`;

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

async function main() {
  if (!fs.existsSync(productExe)) {
    throw new Error(`Packaged executable not found: ${productExe}`);
  }

  const child = spawn(productExe, [`--remote-debugging-port=${debugPort}`], {
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

    console.log(`packaged smoke passed: ${state.title} ${state.url}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stopProcessTree(child.pid);
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
