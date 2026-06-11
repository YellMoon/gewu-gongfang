const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.UI_SMOKE_URL || 'http://localhost:3000';
const screenshotDir = path.join(process.cwd(), 'tmp', 'ui-smoke');
const routes = [
  { path: '/', key: 'home', expectedText: ['选择老师', '本周', '排课'] },
  { path: '/?page=course-calendar', key: 'course-calendar', pageKey: 'course-calendar', expectedText: ['选择老师', '本周', '排课'] },
  { path: '/?page=question-bank-import', key: 'question-bank-import', pageKey: 'question-bank-import', expectedText: ['拖拽或选择 Word 文件', '讲义格式', '试卷格式', '导入任务'] },
  { path: '/?page=question-bank-preview', key: 'question-bank-preview', pageKey: 'question-bank-preview', expectedText: ['试题预览', '知识树', '题干搜索', '更多筛选'] },
  { path: '/?page=question-bank-paper', key: 'question-bank-paper', pageKey: 'question-bank-paper', expectedText: ['题目数', '总分', '参考答案与解析', '答案单独附后'] },
  { path: '/?page=revenue-statistics', key: 'revenue-statistics', pageKey: 'revenue-statistics', expectedText: ['应收学费', '老师课时费', '净收入估算', '排课数量'] },
  { path: '/?page=student', key: 'student', pageKey: 'student', expectedText: ['学生总数', '添加学生', '总账户余额', '课时不足5的学生数'] },
  { path: '/?page=teacher', key: 'teacher', pageKey: 'teacher', expectedText: ['老师总数', '添加老师', '请输入老师姓名', '请选择科目'] },
  { path: '/?page=course-info', key: 'course-info', pageKey: 'course-info', expectedText: ['课程总数', '添加课程', '一对一课程', '自有课程'] },
  { path: '/?page=cloud-sync', key: 'cloud-sync', pageKey: 'cloud-sync', expectedText: ['同步控制', '待同步操作', '客户端 ID', '同步协议说明'] },
];

async function getBodyText(page) {
  return page.locator('body').innerText().then((text) => text.trim());
}

async function waitForAppReady(page) {
  await page.waitForFunction(() => document.body.innerText.trim().length >= 20, null, {
    timeout: 10000,
  });
}

async function waitForExpectedText(page, route) {
  const expectedTexts = Array.isArray(route.expectedText) ? route.expectedText : [route.expectedText];
  await page.waitForFunction((texts) => {
    const bodyText = document.body.innerText;
    return texts.some((text) => text && bodyText.includes(text));
  }, expectedTexts, {
    timeout: 10000,
  }).catch(async () => {
    const bodyText = await getBodyText(page);
    throw new Error(
      `${route.key}: expected page text not found. Expected one of: ${expectedTexts.join(', ')}. Body text length: ${bodyText.length}`
    );
  });
}

async function checkRoute(page, route) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  if (route.pageKey) {
    await page.evaluate((pageKey) => {
      window.dispatchEvent(new CustomEvent('navigate-page', { detail: pageKey }));
    }, route.pageKey);
  }

  await page.waitForTimeout(700);
  await waitForExpectedText(page, route);

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
