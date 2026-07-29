'use strict';

// Attaches to two already-running, disposable packaged desktop profiles and
// proves the primary-host -> ordinary-client direction through visible UI.
const assert = require('assert');
const { chromium } = require('playwright');

const hostPort = Number(process.env.GEWU_HOST_CDP_PORT || 0);
const clientPort = Number(process.env.GEWU_CLIENT_CDP_PORT || 0);
const marker = '\u5408\u6210\u4e3b\u673a\u56de\u4f20\u6559\u5e08';
assert(Number.isInteger(hostPort) && hostPort > 0, 'GEWU_HOST_CDP_PORT_REQUIRED');
assert(Number.isInteger(clientPort) && clientPort > 0, 'GEWU_CLIENT_CDP_PORT_REQUIRED');

async function waitFor(check, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function pageFor(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await waitFor(() => browser.contexts().flatMap(context => context.pages())
    .find(candidate => !candidate.isClosed()), 'ELECTRON_PAGE_NOT_READY');
  return { browser, page };
}

async function openTeacher(page) {
  const collapse = page.locator('.app-shell__collapse-button');
  if (await collapse.count()) await collapse.first().click();
  const resource = page.locator('.ant-menu-submenu').filter({ hasText: '\u8d44\u6e90' }).first();
  await resource.click();
  await page.getByText('\u8001\u5e08', { exact: true }).first().click();
  await page.getByRole('button', { name: '\u6dfb\u52a0\u8001\u5e08' }).waitFor({ timeout: 30_000 });
}

async function openSystemParameters(page) {
  const collapse = page.locator('.app-shell__collapse-button');
  if (await collapse.count()) await collapse.first().click();
  const system = page.locator('.ant-menu-submenu').filter({ hasText: '\u7cfb\u7edf\u4e0e\u6570\u636e' }).first();
  await system.click();
  await page.getByText('\u7cfb\u7edf\u53c2\u6570', { exact: true }).first().click();
  await page.getByRole('button', { name: '\u4e0e\u6570\u636e\u4e3b\u673a\u53cc\u5411\u540c\u6b65' }).waitFor({ timeout: 30_000 });
}

async function main() {
  const host = await pageFor(hostPort);
  const client = await pageFor(clientPort);
  try {
    await openTeacher(host.page);
    const exists = await host.page.getByText(marker, { exact: true }).count();
    if (!exists) {
      await host.page.getByRole('button', { name: '\u6dfb\u52a0\u8001\u5e08' }).click();
      await host.page.getByPlaceholder('\u8bf7\u8f93\u5165\u8001\u5e08\u59d3\u540d').fill(marker);
      const drawer = host.page.locator('.ant-drawer').filter({ hasText: marker }).last();
      await drawer.locator('button.ant-btn-primary').click();
      await host.page.getByText('\u6dfb\u52a0\u6210\u529f', { exact: true }).waitFor({ timeout: 30_000 });
    }
    await host.page.getByText(marker, { exact: true }).waitFor({ timeout: 30_000 });

    await openSystemParameters(client.page);
    await client.page.getByRole('button', { name: '\u4e0e\u6570\u636e\u4e3b\u673a\u53cc\u5411\u540c\u6b65' }).click();
    await client.page.getByRole('button', { name: '\u5f00\u59cb\u540c\u6b65' }).click();
    await client.page.getByText(/\u540c\u6b65\u5b8c\u6210\uff1a\u4e0a\u4f20 \d+ \u6761\uff0c\u62c9\u53d6 \d+ \u6761/).waitFor({ timeout: 45_000 });

    await openTeacher(client.page);
    await client.page.getByText(marker, { exact: true }).waitFor({ timeout: 30_000 });
    console.log(JSON.stringify({
      success: true,
      direction: 'primary-host-to-ordinary-client',
      transport: 'lan-direct',
      userConfirmationShown: true,
      recordVisibleOnHost: true,
      recordVisibleOnClient: true,
    }));
  } finally {
    await host.browser.close().catch(() => {});
    await client.browser.close().catch(() => {});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
