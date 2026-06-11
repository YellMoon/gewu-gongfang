const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.UI_SMOKE_URL || 'http://localhost:3000';
const screenshotDir = path.join(process.cwd(), 'tmp', 'ui-smoke');
const routes = [
  { path: '/', key: 'home' },
  { path: '/?page=course-calendar', key: 'course-calendar', pageKey: 'course-calendar' },
  { path: '/?page=question-bank-import', key: 'question-bank-import', pageKey: 'question-bank-import' },
  { path: '/?page=question-bank-preview', key: 'question-bank-preview', pageKey: 'question-bank-preview' },
  { path: '/?page=question-bank-paper', key: 'question-bank-paper', pageKey: 'question-bank-paper' },
  { path: '/?page=revenue-statistics', key: 'revenue-statistics', pageKey: 'revenue-statistics' },
  { path: '/?page=student', key: 'student', pageKey: 'student' },
  { path: '/?page=teacher', key: 'teacher', pageKey: 'teacher' },
  { path: '/?page=course-info', key: 'course-info', pageKey: 'course-info' },
  { path: '/?page=cloud-sync', key: 'cloud-sync', pageKey: 'cloud-sync' },
];

async function checkRoute(page, route) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  if (route.pageKey) {
    await page.evaluate((pageKey) => {
      window.dispatchEvent(new CustomEvent('navigate-page', { detail: pageKey }));
    }, route.pageKey);
  }

  await page.waitForTimeout(700);

  const bodyTextLength = await page.locator('body').innerText().then((text) => text.trim().length);
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
