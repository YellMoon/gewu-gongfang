const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.UI_SMOKE_URL || 'http://localhost:3000';
const screenshotDir = path.join(process.cwd(), 'tmp', 'ui-smoke');
const routes = [
  // Home renders the default today workbench.
  { path: '/', key: 'home', requiredText: ['今日工作台', '题库问题', '排课列表'] },
  { path: '/?page=course-calendar', key: 'course-calendar', pageKey: 'course-calendar', requiredText: ['课程表', '刷新课程信息', '本周'] },
  { path: '/?page=schedule-list', key: 'schedule-list', pageKey: 'schedule-list', requiredText: ['排课列表', '查询', '导出'] },
  { path: '/?page=question-bank-tools', key: 'question-bank-tools', pageKey: 'question-bank-tools', requiredText: ['题库工具', '导入与知识树'] },
  { path: '/?page=question-bank-import', key: 'question-bank-import', pageKey: 'question-bank-import', requiredText: ['拖拽或选择 Word 文件', '讲义格式'] },
  { path: '/?page=question-bank-preview', key: 'question-bank-preview', pageKey: 'question-bank-preview', requiredText: ['试题库', '更多筛选'] },
  { path: '/?page=question-bank-paper', key: 'question-bank-paper', pageKey: 'question-bank-paper', requiredText: ['题目数', '总分'] },
  { path: '/?page=revenue-statistics', key: 'revenue-statistics', pageKey: 'revenue-statistics', requiredText: ['应收学费', '老师课时费'] },
  { path: '/?page=payment', key: 'payment', pageKey: 'payment', requiredText: ['总缴费笔数', '添加缴费记录'] },
  { path: '/?page=student', key: 'student', pageKey: 'student', requiredText: ['学生总数', '添加学生'] },
  { path: '/?page=teacher', key: 'teacher', pageKey: 'teacher', requiredText: ['老师总数', '添加老师'] },
  { path: '/?page=course-info', key: 'course-info', pageKey: 'course-info', requiredText: ['课程总数', '添加课程'] },
  { path: '/?page=school', key: 'school', pageKey: 'school', requiredText: ['学校总数', '添加学校'] },
  { path: '/?page=address', key: 'address', pageKey: 'address', requiredText: ['地址总数', '添加地址'] },
  { path: '/?page=institution', key: 'institution', pageKey: 'institution', requiredText: ['机构总数', '添加机构'] },
  { path: '/?page=operate-log', key: 'operate-log', pageKey: 'operate-log', requiredText: ['操作审计', '刷新'] },
  { path: '/?page=cloud-sync', key: 'cloud-sync', pageKey: 'cloud-sync', requiredText: ['同步控制', '待同步操作'] },
];

async function getBodyText(page) {
  return page.locator('body').innerText().then((text) => text.trim());
}

async function waitForAppReady(page) {
  await page.waitForFunction(() => document.body.innerText.trim().length >= 20, null, {
    timeout: 10000,
  });
}

async function installNavigationProbe(page) {
  await page.addInitScript(() => {
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
      `${route.key}: required page text not found. Required: ${requiredTexts.join(', ')}. Missing: ${missingTexts.join(', ')}. Body text length: ${bodyText.length}`
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
