const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const screenshotDir = path.join(root, 'output', 'miniapp-review-5.14.4');
  fs.mkdirSync(screenshotDir, { recursive: true });
  console.log('[probe] connecting');
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  console.log('[probe] connected');
  try {
    const page = await miniProgram.currentPage();
    console.log(`[probe] page ${page?.path || 'missing'}`);
    const info = await miniProgram.systemInfo();
    console.log('[probe] system info');
    await miniProgram.screenshot({ path: path.join(screenshotDir, 'guest-login.png') });
    console.log('[probe] screenshot');
    console.log(JSON.stringify({ page: page?.path, query: page?.query, platform: info.platform, model: info.model }, null, 2));
  } finally {
    miniProgram.disconnect();
  }
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
