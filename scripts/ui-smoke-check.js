const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.UI_SMOKE_URL || 'http://localhost:3000';
const screenshotDir = path.join(process.cwd(), 'tmp', 'ui-smoke');
const allRoutes = [
  // Home renders the default today workbench.
  { path: '/', key: 'home', requiredText: ['今日工作台', '课程表', '学生费用欠缴'] },
  { path: '/?page=course-calendar', key: 'course-calendar', pageKey: 'course-calendar', requiredText: ['课程表', '刷新课程信息', '本周'] },
  { path: '/?page=schedule-list', key: 'schedule-list', pageKey: 'schedule-list', requiredText: ['排课列表', '查询', '导出'] },
  { path: '/?page=question-bank-tools', key: 'question-bank-tools', pageKey: 'question-bank-tools', requiredText: ['题库工具', '导入与体系'] },
  { path: '/?page=question-bank-import', key: 'question-bank-import', pageKey: 'question-bank-import', requiredText: ['拖拽或选择 Word 文件', '讲义格式'] },
  { path: '/?page=question-bank-preview', key: 'question-bank-preview', pageKey: 'question-bank-preview', requiredText: ['试题库', '更多筛选'] },
  { path: '/?page=question-bank-paper', key: 'question-bank-paper', pageKey: 'question-bank-paper', requiredText: ['题目数', '总分'] },
  { path: '/?page=revenue-statistics', key: 'revenue-statistics', pageKey: 'revenue-statistics', requiredText: ['应收学费', '老师课时费'] },
  { path: '/?page=payment', key: 'payment', pageKey: 'payment', requiredText: ['总缴费笔数', '添加缴费记录'] },
  { path: '/?page=student', key: 'student', pageKey: 'student', requiredText: ['学生总数', '添加学生'] },
  { path: '/?page=teacher', key: 'teacher', pageKey: 'teacher', requiredText: ['老师总数', '添加老师'] },
  { path: '/?page=course-info', key: 'course-info', pageKey: 'course-info', requiredText: ['添加课程', '课程名称'] },
  { path: '/?page=school', key: 'school', pageKey: 'school', requiredText: ['学校总数', '添加学校'] },
  { path: '/?page=address', key: 'address', pageKey: 'address', requiredText: ['地址总数', '添加地址'] },
  { path: '/?page=institution', key: 'institution', pageKey: 'institution', requiredText: ['机构总数', '添加机构'] },
  { path: '/?page=operate-log', key: 'operate-log', pageKey: 'operate-log', requiredText: ['操作审计', '刷新'] },
  { path: '/?page=cloud-sync', key: 'cloud-sync', pageKey: 'cloud-sync', requiredText: ['账号与同步', '待提交的更改'] },
];
const requestedRoute = String(process.env.UI_SMOKE_ROUTE || '').trim();
const routes = requestedRoute ? allRoutes.filter(route => route.key === requestedRoute) : allRoutes;
if (requestedRoute && routes.length === 0) throw new Error(`Unknown UI smoke route: ${requestedRoute}`);

async function getBodyText(page) {
  return page.locator('body').innerText().then((text) => text.trim());
}

async function waitForAppReady(page) {
  await page.waitForFunction(() => document.body.innerText.trim().length >= 20, null, {
    timeout: 10000,
  });
  await page.waitForFunction(() => Boolean(window.dbService), null, {
    timeout: 10000,
  }).catch(async () => {
    const diagnostic = await page.evaluate(() => ({
      online: navigator.onLine,
      apiInvoke: typeof window.api?.invoke,
      identityStatus: typeof window.desktopIdentity?.status,
      sessionProvider: typeof window.desktopIdentitySessionProvider,
      visibleText: document.body.innerText.slice(0, 300),
    }));
    throw new Error(`desktop database service did not become ready: ${JSON.stringify(diagnostic)}`);
  });
}

async function installNavigationProbe(page) {
  await page.addInitScript(() => {
    const now = Date.now();
    const userId = 'ui-smoke-super-admin';
    const deviceId = 'ui-smoke-device';
    const authorizationId = 'ui-smoke-authorization';
    const partitionKey = `${userId}:super_admin:all`;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.__GEWU_DESKTOP_IDENTITY_PARTITION__ = partitionKey;
    window.__GEWU_DESKTOP_IDENTITY_CONTEXT__ = Object.freeze({
      userId,
      activeRole: 'super_admin',
      teacherId: null,
      studentId: null,
      partitionKey,
      offline: true,
    });
    window.api = {
      invoke: async (channel) => {
        if (channel === 'runtime-config:get') {
          return {
            buildFlavor: 'desktop-client',
            primaryHostCapable: false,
            nodeRole: 'desktop-client',
            desktopIdentityMode: 'full',
            deviceId,
            deviceName: 'UI smoke isolated client',
            primaryHostEpochId: '',
            primaryHostGeneration: null,
            hostBaseUrl: 'http://127.0.0.1:3001',
            cloudBaseUrl: 'http://127.0.0.1:3001',
            desktopSyncToken: '',
            mainDbPath: '',
            questionBankPath: '',
            questionAssetPath: '',
            questionBankCandidatePaths: [],
            questionBankStoreId: '',
            localCachePath: '',
            nasBackupPath: '',
          };
        }
        if (channel === 'get-app-version') return 'ui-smoke';
        return null;
      },
    };
    window.desktopAuthority = {
      list: async () => [],
    };
    window.desktopIdentity = {
      status: async () => ({
        state: 'active',
        unlocked: true,
        deviceId,
        authorizationId,
        credentialVersion: 1,
        user: { id: userId, name: 'UI smoke administrator' },
        eligibleRoles: ['super_admin'],
        activeRole: 'super_admin',
        teacherId: null,
        studentId: null,
        offlineLease: {
          issuedAt: new Date(now - 60_000).toISOString(),
          expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
          userId,
          deviceId,
          authorizationId,
          credentialVersion: 1,
          eligibleRoles: ['super_admin'],
          activeRole: 'super_admin',
          teacherId: null,
          studentId: null,
        },
      }),
      lock: async () => ({ state: 'sealed', unlocked: false }),
    };
    window.__uiSmokeNavigateReady = false;
    const nativeAddEventListener = window.addEventListener;
    window.addEventListener = function addEventListener(type, listener, options) {
      if (type === 'navigate-page') {
        window.__uiSmokeNavigateReady = true;
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };
  });
}

async function waitForNavigationListener(page) {
  await page.waitForFunction(() => window.__uiSmokeNavigateReady === true, null, {
    timeout: 10000,
  });
}

async function waitForRequiredText(page, route) {
  const requiredTexts = route.requiredText;
  await page.waitForFunction((texts) => {
    const bodyText = document.body.innerText;
    return texts.every((text) => text && bodyText.includes(text));
  }, requiredTexts, {
    timeout: 10000,
  }).catch(async () => {
    const bodyText = await getBodyText(page);
    const missingTexts = requiredTexts.filter((text) => !bodyText.includes(text));
    throw new Error(
      `${route.key}: required page text not found. Required: ${requiredTexts.join(', ')}. Missing: ${missingTexts.join(', ')}. Body: ${bodyText.slice(0, 1000)}`
    );
  });
}

async function checkRoute(page, route) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await waitForNavigationListener(page);

  if (route.pageKey) {
    await page.evaluate((pageKey) => {
      window.dispatchEvent(new CustomEvent('navigate-page', { detail: pageKey }));
    }, route.pageKey);
  }

  await page.waitForTimeout(700);
  await waitForRequiredText(page, route);

  const bodyTextLength = await getBodyText(page).then((text) => text.length);
  if (bodyTextLength < 20) {
    throw new Error(`${route.key}: body text is too short (${bodyTextLength})`);
  }

  const narrowButtons = await page.locator('button:visible').evaluateAll((buttons) => {
    return buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          text: (button.innerText || button.getAttribute('aria-label') || button.title || '').trim(),
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((button) => button.width > 0 && button.height > 0 && button.width < 24);
  });

  if (narrowButtons.length > 0) {
    const details = narrowButtons
      .map((button) => {
        const label = button.text || '<unlabeled>';
        return `${label} (${button.width.toFixed(1)}x${button.height.toFixed(1)})`;
      })
      .join(', ');
    throw new Error(`${route.key}: suspiciously narrow visible buttons: ${details}`);
  }

  if (route.key === 'question-bank-preview') {
    let removeSystemButton = page.locator('.taxonomy-system-title button.ant-btn-dangerous').last();
    if (await removeSystemButton.count() === 0) {
      await page.evaluate(() => {
        const database = window.dbService;
        if ((database?.getTaxonomySystems?.('\u7269\u7406') || []).length === 0) {
          database.createTaxonomySystem({ name: '\u8fd0\u884c\u9a8c\u8bc1\u4f53\u7cfb', subject: '\u7269\u7406' });
        }
        window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'question-bank-tools' }));
      });
      await page.getByText('\u9898\u5e93\u5de5\u5177', { exact: true }).first().waitFor();
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'question-bank-preview' }));
      });
      await waitForRequiredText(page, route);
      removeSystemButton = page.locator('.taxonomy-system-title button.ant-btn-dangerous').last();
      await removeSystemButton.waitFor();
    }
    await removeSystemButton.click();
    const confirmation = page.getByRole('dialog').filter({ hasText: '删除体系' });
    await confirmation.getByText(/将影响 \d+ 道试题，删除 \d+ 个节点。/).waitFor();
    await confirmation.getByText('操作前会自动保留可恢复备份和审计记录。', { exact: false }).waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotDir, 'question-bank-taxonomy-delete-confirm.png'),
      fullPage: true,
    });
    await confirmation.locator('.ant-btn-default').click();
  }

  await page.screenshot({
    path: path.join(screenshotDir, `${route.key}.png`),
    fullPage: true,
  });
}

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true });

  let browser;
  const failures = [];
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await installNavigationProbe(page);

    for (const route of routes) {
      try {
        await checkRoute(page, route);
        console.log(`OK ${route.key}`);
      } catch (error) {
        failures.push(error);
        console.error(`FAIL ${route.key}: ${error.message}`);
      }
    }
  } finally {
    if (browser) {
      await browser.close().catch((error) => {
        console.error(`Failed to close browser: ${error.message}`);
      });
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
