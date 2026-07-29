'use strict';

const { chromium } = require('playwright');

const password = 'SyntheticHostUiPassword-2026';
const cdpPort = Number(process.env.GEWU_PACKAGED_HOST_CDP_PORT || 0);
if (!Number.isInteger(cdpPort) || cdpPort < 1) throw new Error('GEWU_PACKAGED_HOST_CDP_PORT_REQUIRED');

async function waitFor(check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (_error) { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('ELECTRON_UI_NOT_READY');
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await waitFor(() => browser.contexts().flatMap(context => context.pages()).find(item => !item.isClosed()));
  const unlock = page.getByPlaceholder('\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801');
  if (await unlock.isVisible().catch(() => false)) {
    await unlock.fill(password);
    await page.getByRole('button', { name: '\u9a8c\u8bc1\u5e76\u8fdb\u5165' }).click();
  }
  await page.getByRole('button', { name: '\u9501\u5b9a' }).waitFor({ timeout: 30_000 });
  await page.getByTitle('\u9501\u5b9a\u5c55\u5f00\u5bfc\u822a').click();
  await page.getByText('\u7cfb\u7edf\u4e0e\u6570\u636e', { exact: true }).click();
  await page.getByText('\u8eab\u4efd\u4e0e\u8bbe\u5907', { exact: true }).click();
  await page.getByRole('button', { name: '\u751f\u6210\u4e00\u6b21\u6027\u914d\u5bf9\u7801' }).click();
  const code = await waitFor(async () => {
    const headings = await page.locator('h3').allTextContents();
    return headings.find(value => /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(value)) || null;
  });
  console.log(`PAIRING_CODE=${code.replace(/-/g, '')}`);
  await browser.close();
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
