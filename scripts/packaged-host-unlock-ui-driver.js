'use strict';

// Second half of the packaged host UI check. It deliberately connects to an
// already-running disposable Electron process so app.relaunch() cannot end the
// test runner's Windows job before the post-restart unlock is verified.
const assert = require('assert');
const { chromium } = require('playwright');

const TEST_PASSWORD = 'SyntheticHostUiPassword-2026';
const cdpPort = Number(process.env.GEWU_PACKAGED_HOST_CDP_PORT || 0);
assert(Number.isInteger(cdpPort) && cdpPort > 0, 'GEWU_PACKAGED_HOST_CDP_PORT_REQUIRED');

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

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await waitFor(() => browser.contexts()
    .flatMap(context => context.pages())
    .find(candidate => !candidate.isClosed()), 'ELECTRON_RENDERER_NOT_READY');
  const consoleErrors = [];
  const identityResponses = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', async response => {
    if (!response.url().includes('/api/desktop-identity/')) return;
    try {
      const payload = await response.json();
      identityResponses.push({ url: response.url(), status: response.status(), code: payload?.code || null });
    } catch (_error) { /* non-JSON diagnostics are not part of this contract */ }
  });
  await page.getByPlaceholder('\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '\u9a8c\u8bc1\u5e76\u8fdb\u5165' }).click();
  await new Promise(resolve => setTimeout(resolve, 3_000));
  console.error(`post-unlock driver body: ${JSON.stringify(await page.locator('body').innerText())}`);
  console.error(`post-unlock driver renderer errors: ${JSON.stringify(consoleErrors)}`);
  console.error(`post-unlock identity responses: ${JSON.stringify(identityResponses)}`);
  await page.getByRole('button', { name: '\u9501\u5b9a' }).waitFor({ timeout: 30_000 });
  assert.strictEqual(consoleErrors.some(message => /Content Security Policy|violates the following Content Security Policy/i.test(message)), false,
    'packaged host must allow its configured loopback API port');
  console.log('packaged host post-restart identity unlock UI check passed');
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
