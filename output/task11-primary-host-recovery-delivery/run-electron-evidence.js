const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const evidenceDir = __dirname;
const projectRoot = path.resolve(evidenceDir, '..', '..');
const fixtureMain = path.join(evidenceDir, 'electron-fixture-main.js');
const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-task11-recovery-delivery-'));
const rendererErrors = [];
const mainProcessErrors = [];
const expectedMainProcessDiagnostics = [];
const screenshots = [];
const networkFailures = [];
let electronVersion = '';
let chromiumVersion = '';
let activeApp = null;
let activePage = null;

function screenshotPath(name) {
  const target = path.join(evidenceDir, name);
  screenshots.push(name);
  return target;
}

async function launch(label, { nodeRole = 'desktop-client' } = {}) {
  const electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [fixtureMain],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      GEWU_FIXTURE_ROOT: projectRoot,
      GEWU_FIXTURE_USER_DATA: userDataPath,
      GEWU_FIXTURE_NODE_ROLE: nodeRole,
      NODE_ENV: 'production',
    },
    timeout: 60_000,
  });
  activeApp = electronApp;
  const child = electronApp.process();
  let collectingExpectedAckDiagnostic = false;
  child.stderr?.on('data', chunk => {
    const lines = String(chunk || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const value of lines) {
      if (/^(Debugger listening on|Debugger ending on|For help, see:)/.test(value)) continue;
      if (value.includes("Error occurred in handler for 'primary-host:acknowledge-recovery-package'")
        && value.includes('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_NETWORK')) {
        collectingExpectedAckDiagnostic = true;
        expectedMainProcessDiagnostics.push({ launch: label, message: value });
        continue;
      }
      if (collectingExpectedAckDiagnostic && /^at /.test(value)) {
        expectedMainProcessDiagnostics.push({ launch: label, message: value });
        if (value.includes('WebContents.emit')) collectingExpectedAckDiagnostic = false;
        continue;
      }
      mainProcessErrors.push({ launch: label, message: value });
    }
  });
  const versions = await electronApp.evaluate(() => ({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
  }));
  electronVersion = versions.electron;
  chromiumVersion = versions.chromium;
  const page = await electronApp.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixtureConfig = await page.evaluate(() => window.api.invoke('runtime-config:get'));
  const loopbackBaseUrl = String(fixtureConfig.cloudBaseUrl || '').replace(/\/+$/, '');
  assert.match(loopbackBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/, 'fixture identity proxy must target loopback');
  const proxyToLoopback = async route => {
    const request = route.request();
    const sourceUrl = new URL(request.url());
    const loopbackPath = sourceUrl.pathname.replace(/^\/scheduling/, '') || '/';
    const response = await route.fetch({
      url: `${loopbackBaseUrl}${loopbackPath}${sourceUrl.search}`,
    });
    await route.fulfill({ response });
  };
  await page.route('https://physicsedu.xyz/scheduling/**', proxyToLoopback);
  await page.route('http://localhost:3001/**', proxyToLoopback);
  page.on('console', message => {
    if (message.type() === 'error') {
      rendererErrors.push({ launch: label, kind: 'console', message: message.text() });
    }
  });
  page.on('pageerror', error => {
    rendererErrors.push({ launch: label, kind: 'pageerror', message: error.message });
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      networkFailures.push({ launch: label, status: response.status(), url: response.url() });
    }
  });
  page.on('requestfailed', request => {
    networkFailures.push({ launch: label, status: 'failed', url: request.url(), error: request.failure()?.errorText || '' });
  });
  activePage = page;
  return { electronApp, page };
}

async function unlock(page) {
  await page.getByRole('heading', { name: '\u683c\u7269\u5de5\u574a\u8eab\u4efd\u9a8c\u8bc1' }).waitFor({ timeout: 30_000 });
  await page.getByPlaceholder('\u8bf7\u8f93\u5165\u672c\u673a\u5bc6\u7801').fill('fixture-new-password');
  await page.getByRole('button', { name: '\u9a8c\u8bc1\u5e76\u8fdb\u5165' }).click();
  await page.getByText('\u4eca\u65e5\u5de5\u4f5c\u53f0', { exact: true }).first().waitFor({ timeout: 30_000 });
}

async function completePasswordReset(page) {
  await page.getByRole('button', { name: '\u5fd8\u8bb0\u672c\u673a\u5bc6\u7801\uff1f\u91cd\u65b0\u6838\u9a8c\u8eab\u4efd\u5e76\u91cd\u8bbe' }).click();
  await page.getByText('654321', { exact: true }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: screenshotPath('00a-password-reset-phone-verification.png') });
  const firstPassword = page.getByPlaceholder('\u81f3\u5c11 6 \u4e2a\u5b57\u7b26');
  await firstPassword.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshotPath('00b-password-reset-approved.png') });
  await firstPassword.fill('fixture-new-password');
  await page.getByPlaceholder('\u518d\u6b21\u8f93\u5165\u672c\u673a\u5bc6\u7801').fill('fixture-new-password');
  await page.getByRole('button', { name: '\u4fdd\u5b58\u672c\u673a\u5bc6\u7801\u5e76\u8fdb\u5165' }).click();
  await page.getByText('\u4eca\u65e5\u5de5\u4f5c\u53f0', { exact: true }).first().waitFor({ timeout: 30_000 });
}

async function openDeviceCenter(page) {
  await page.getByText('\u7cfb\u7edf\u4e0e\u6570\u636e', { exact: true }).first().evaluate(element => element.click());
  await page.getByText('\u8eab\u4efd\u4e0e\u8bbe\u5907', { exact: true }).first().evaluate(element => element.click());
  await page.locator('.identity-device-center').waitFor({ timeout: 30_000 });
}

async function openSystemSettings(page) {
  await page.getByText('\u7cfb\u7edf\u4e0e\u6570\u636e', { exact: true }).first().evaluate(element => element.click());
  await page.getByText('\u7cfb\u7edf\u53c2\u6570', { exact: true }).first().evaluate(element => element.click());
  await page.getByText('\u8f6f\u4ef6\u66f4\u65b0', { exact: true }).waitFor({ timeout: 30_000 });
}

function deliveryDialog(page) {
  return page.getByRole('dialog').filter({ hasText: '\u6062\u590d\u5305\u5c1a\u672a\u786e\u8ba4\u4ea4\u4ed8' });
}

async function assertPendingCannotClose(page) {
  const dialog = deliveryDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  assert.strictEqual(await dialog.locator('.ant-modal-close').count(), 0, 'pending delivery modal must have no close affordance');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'visible' });
  await page.mouse.click(12, 220);
  await dialog.waitFor({ state: 'visible' });
}

async function reveal(page) {
  await page.getByRole('button', { name: '\u663e\u793a\u4e00\u6b21\u6027\u6062\u590d\u5305' }).click();
  await page.getByText('FIXTURE-RECOVERY-CODE-ONLY-NOT-A-REAL-SECRET-0001', { exact: false })
    .waitFor({ timeout: 15_000 });
}

async function run() {
  console.log('stage: initial launch');
  let current = await launch('initial');
  await current.page.getByRole('button', { name: '\u5fd8\u8bb0\u672c\u673a\u5bc6\u7801\uff1f\u91cd\u65b0\u6838\u9a8c\u8eab\u4efd\u5e76\u91cd\u8bbe' })
    .waitFor({ timeout: 30_000 });
  await current.page.screenshot({ path: screenshotPath('00-password-reset-entry.png') });
  await completePasswordReset(current.page);
  console.log('stage: initial unlock');
  await openDeviceCenter(current.page);
  await assertPendingCannotClose(current.page);
  await current.page.screenshot({ path: screenshotPath('01-pending-before-reveal.png') });

  await reveal(current.page);
  console.log('stage: initial reveal');
  await current.page.screenshot({ path: screenshotPath('02-revealed-package-and-copy.png') });

  await current.page.reload({ waitUntil: 'domcontentloaded' });
  await unlock(current.page);
  await openDeviceCenter(current.page);
  await assertPendingCannotClose(current.page);
  await current.page.getByRole('button', { name: '\u663e\u793a\u4e00\u6b21\u6027\u6062\u590d\u5305' }).waitFor();
  await current.electronApp.close();
  activeApp = null;
  activePage = null;

  console.log('stage: process relaunch');
  current = await launch('relaunch');
  await unlock(current.page);
  await openDeviceCenter(current.page);
  await assertPendingCannotClose(current.page);
  await current.page.screenshot({ path: screenshotPath('02b-process-relaunch-pending.png') });
  await reveal(current.page);

  const acknowledge = current.page.getByRole('button', { name: '\u6211\u5df2\u79bb\u7ebf\u4fdd\u5b58\uff0c\u786e\u8ba4\u4ea4\u4ed8\u5e76\u91cd\u542f' });
  await acknowledge.click();
  await current.page.getByText('\u8eab\u4efd\u4e0e\u8bbe\u5907\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5\u4e3b\u673a\u8fde\u63a5\u540e\u91cd\u8bd5\u3002', { exact: true })
    .last().waitFor({ timeout: 15_000 });
  await deliveryDialog(current.page).waitFor({ state: 'visible' });
  await current.page.getByText('FIXTURE-RECOVERY-CODE-ONLY-NOT-A-REAL-SECRET-0001', { exact: false }).waitFor();
  await current.page.screenshot({ path: screenshotPath('03-ack-outage-retains-modal-and-secret.png') });
  console.log('stage: acknowledgement outage retained');

  await acknowledge.click();
  await deliveryDialog(current.page).waitFor({ state: 'hidden', timeout: 15_000 });
  await current.page.reload({ waitUntil: 'domcontentloaded' });
  await unlock(current.page);
  await openDeviceCenter(current.page);
  await current.page.getByText('\u6062\u590d\u5305\u5c1a\u672a\u786e\u8ba4\u4ea4\u4ed8', { exact: true }).waitFor({ state: 'hidden' });
  await current.page.screenshot({ path: screenshotPath('04-acknowledged-high-risk-unblocked.png') });
  console.log('stage: acknowledgement retry cleared');

  await current.page.getByRole('button', { name: '\u5207\u6362\u4e3a\u8001\u5e08' }).click();
  await current.page.getByText('\u8001\u5e08', { exact: true }).first().waitFor({ timeout: 15_000 });
  await current.page.setViewportSize({ width: 900, height: 720 });
  const narrowOverflow = await current.page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    narrowOverflow.scrollWidth <= narrowOverflow.clientWidth + 1,
    `narrow desktop must not overflow horizontally: ${JSON.stringify(narrowOverflow)}`
  );
  await current.page.screenshot({ path: screenshotPath('04a-teacher-narrow-runtime.png') });
  await current.page.setViewportSize({ width: 1440, height: 900 });
  await current.page.getByRole('button', { name: '\u5207\u6362\u4e3a\u8d85\u7ea7\u7ba1\u7406\u5458' }).click();
  await current.page.getByPlaceholder('\u518d\u6b21\u8f93\u5165\u672c\u673a\u5bc6\u7801').fill('fixture-new-password');
  await current.page.getByRole('button', { name: '\u9a8c\u8bc1\u5e76\u5207\u6362' }).click();
  await current.page.getByText('\u8d85\u7ea7\u7ba1\u7406\u5458', { exact: true }).first().waitFor({ timeout: 15_000 });

  await openSystemSettings(current.page);
  await current.page.getByRole('button', { name: '\u68c0\u67e5\u66f4\u65b0' }).click();
  await current.page.getByText('https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/', { exact: true })
    .waitFor({ timeout: 15_000 });
  await current.page.screenshot({ path: screenshotPath('05-system-settings-oss-update-check.png') });
  await current.electronApp.close();
  activeApp = null;
  activePage = null;

  current = await launch('offline');
  await current.page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  });
  await current.page.reload({ waitUntil: 'domcontentloaded' });
  await current.page.setViewportSize({ width: 900, height: 720 });
  await unlock(current.page);
  await current.page.getByText('\u5f53\u524d\u4e3a\u79bb\u7ebf\u8eab\u4efd\u79df\u7ea6\uff1a\u53ef\u7ee7\u7eed\u7f16\u8f91\u672c\u89d2\u8272\u7f13\u5b58\uff0c\u4f46\u4e0d\u80fd\u540c\u6b65\u3001\u5ba1\u6838\u8bbe\u5907\u6216\u6267\u884c\u4e3b\u673a\u5199\u64cd\u4f5c\u3002', { exact: true })
    .waitFor({ timeout: 15_000 });
  await current.page.screenshot({ path: screenshotPath('06-offline-lease-narrow-runtime.png') });
  await current.electronApp.close();
  activeApp = null;
  activePage = null;

  current = await launch('primary-host', { nodeRole: 'primary-host' });
  await unlock(current.page);
  await openDeviceCenter(current.page);
  await current.page.getByText('\u5f53\u524d\u8eab\u4efd', { exact: true }).first().waitFor({ timeout: 15_000 });
  await current.page.screenshot({ path: screenshotPath('07-primary-host-wide-device-center.png') });
  await current.electronApp.close();
  activeApp = null;
  activePage = null;

  assert.deepStrictEqual(rendererErrors, [], `renderer errors: ${JSON.stringify(rendererErrors)}`);
  assert.deepStrictEqual(mainProcessErrors, [], `main-process errors: ${JSON.stringify(mainProcessErrors)}`);
  assert.deepStrictEqual(networkFailures, [], `network failures: ${JSON.stringify(networkFailures)}`);
  assert.strictEqual(
    expectedMainProcessDiagnostics.filter(item => item.message.includes('PRIMARY_HOST_RECOVERY_DELIVERY_ACK_NETWORK')).length,
    1,
    'fixture must inject exactly one acknowledgement outage'
  );
  const metadata = {
    verificationStatus: 'passed',
    capturedAt: new Date().toISOString(),
    electronVersion,
    chromiumVersion,
    viewport: { width: 1440, height: 900 },
    fixture: {
      transport: 'loopback-only',
      userData: 'temporary-isolated-directory',
      epochId: 'fixture-epoch-1',
      deliveryId: 'fixture-delivery-1',
      recoveryCode: 'synthetic-redacted-in-metadata',
      managedIdentityUrlInterceptedToLoopback: true,
    },
    assertions: {
      noCloseAffordance: true,
      escapeCannotClose: true,
      maskClickCannotClose: true,
      reloadRetainsPendingDelivery: true,
      processRelaunchRetainsPendingDelivery: true,
      acknowledgementOutageRetainsSecret: true,
      acknowledgementRetryClearsPending: true,
      ossUpdateCardCheckReturnsFeedUrl: true,
      passwordResetEntryVisible: true,
      passwordResetPhoneVerificationVisible: true,
      passwordResetApprovalAndNewPasswordVisible: true,
      passwordResetCompletesIntoBusinessRuntime: true,
      teacherRoleNarrowRuntimeVisible: true,
      narrowRuntimeHasNoHorizontalOverflow: true,
      offlineLeaseNarrowRuntimeVisible: true,
      primaryHostWideDeviceCenterVisible: true,
      rendererErrors: 0,
      mainProcessErrors: 0,
      expectedAcknowledgementOutageDiagnostics: expectedMainProcessDiagnostics.length,
    },
    networkFailures,
    expectedMainProcessDiagnostics,
    screenshots,
  };
  const priorFailure = path.join(evidenceDir, 'electron-evidence-failure.json');
  if (fs.existsSync(priorFailure)) fs.unlinkSync(priorFailure);
  fs.writeFileSync(path.join(evidenceDir, 'electron-evidence.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  fs.rmSync(userDataPath, { recursive: true, force: true });
  console.log(JSON.stringify(metadata, null, 2));
}

run().catch(async error => {
  let pageText = '';
  try {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: path.join(evidenceDir, 'failure-current-window.png') });
      pageText = (await activePage.locator('body').innerText()).slice(0, 4000);
    }
  } catch (_captureError) { /* best effort failure evidence */ }
  try {
    if (activeApp) await activeApp.close();
  } catch (_closeError) { /* best effort isolated-process cleanup */ }
  const failure = {
    verificationStatus: 'failed',
    capturedAt: new Date().toISOString(),
    error: String(error?.stack || error),
    rendererErrors,
    mainProcessErrors,
    expectedMainProcessDiagnostics,
    networkFailures,
    pageText,
    screenshots,
  };
  fs.writeFileSync(path.join(evidenceDir, 'electron-evidence-failure.json'), `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
  process.stderr.write(`${failure.error}\n`);
  process.exitCode = 1;
});
