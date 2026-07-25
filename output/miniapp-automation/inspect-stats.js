const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const redact = value => {
  const secret = process.env.MINIAPP_REVIEW_EXPERIENCE_CODE || '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return secret ? text.split(secret).join('[REDACTED]') : text;
};

const inspectElement = async (page, selector) => {
  const element = await page.$(selector);
  if (!element) return { selector, present: false };
  const result = {
    selector,
    present: true,
    tagName: element.tagName,
    text: redact(await element.text()),
    size: await element.size(),
    offset: await element.offset(),
  };
  if (selector === '.container') {
    result.outerWxml = redact(await element.outerWxml());
  }
  return result;
};

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const screenshotDir = path.join(root, 'output', 'miniapp-review-5.14.4');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const consoleEvents = [];
  const exceptionEvents = [];
  miniProgram.on('console', event => consoleEvents.push(redact(event)));
  miniProgram.on('exception', event => exceptionEvents.push(redact(event)));

  try {
    const page = await miniProgram.reLaunch('/pages/stats/index');
    await page.waitFor(2000);
    const current = await miniProgram.currentPage();
    const selectors = [
      '.container',
      '.review-demo-banner',
      '.revenue-card',
      '.revenue-label',
      '.revenue-amount',
      '.empty-state',
      '.card',
    ];
    const elements = [];
    for (const selector of selectors) {
      elements.push(await inspectElement(current, selector));
    }
    await miniProgram.screenshot({ path: path.join(screenshotDir, 'admin-stats-automator-before.png') });
    const storageInfo = await miniProgram.evaluate(() => ({
      hasToken: Boolean(wx.getStorageSync('auth_token')),
      hasUser: Boolean(wx.getStorageSync('user_info')),
      hasSchedules: Array.isArray(wx.getStorageSync('schedules')),
      hasCourses: Array.isArray(wx.getStorageSync('courses')),
    }));
    console.log(JSON.stringify({
      page: current && current.path,
      pageSize: await current.size(),
      elements,
      storageInfo,
      consoleEvents: consoleEvents.slice(-20),
      exceptionEvents: exceptionEvents.slice(-20),
    }, null, 2));
  } finally {
    miniProgram.disconnect();
  }
})().catch(error => {
  console.error(redact(error && (error.stack || error.message || error)));
  process.exitCode = 1;
});
