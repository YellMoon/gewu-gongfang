const fs = require('fs');
const path = require('path');
const automator = require('../output/miniapp-automation/node_modules/miniprogram-automator');

(async () => {
  const watchdog = setTimeout(() => {
    console.error('AUTOMATION_HANDSHAKE_TIMEOUT');
    process.exit(2);
  }, 15000);
  const root = path.resolve(__dirname, '..');
  const evidenceDir = path.join(root, 'output', 'miniapp-6.1.0-ui-coverage');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint: process.argv[2] || 'ws://[::1]:9430' });
  try {
    const page = await miniProgram.currentPage();
    const info = await miniProgram.systemInfo();
    await miniProgram.screenshot({ path: path.join(evidenceDir, 'runtime-current-page.png') });
    console.log(JSON.stringify({
      page: page?.path || null,
      queryKeys: Object.keys(page?.query || {}).sort(),
      platform: info.platform,
      model: info.model,
    }));
    clearTimeout(watchdog);
  } finally {
    miniProgram.disconnect();
  }
})().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
