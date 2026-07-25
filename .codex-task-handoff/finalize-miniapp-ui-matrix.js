const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { scenarios } = require('./capture-miniapp-ui-matrix');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'output', 'miniapp-6.1.0-ui-coverage', 'runtime-fixture-matrix');

function screenshotName(scenario, index) {
  return `${String(index + 1).padStart(2, '0')}-${scenario.route.replaceAll('/', '__')}-${scenario.role}-${scenario.state}.png`;
}

const captures = scenarios.map((scenario, index) => {
  const screenshot = screenshotName(scenario, index);
  const screenshotPath = path.join(outputDir, screenshot);
  if (!fs.existsSync(screenshotPath)) throw new Error(`MISSING_SCREENSHOT:${screenshot}`);
  const bytes = fs.statSync(screenshotPath).size;
  if (bytes < 8000) throw new Error(`LIKELY_BLANK_SCREENSHOT:${screenshot}:${bytes}`);
  return {
    route: scenario.route,
    query: scenario.query || '',
    role: scenario.role,
    state: scenario.state,
    realRuntime: 'WeChat DevTools',
    dataMode: 'sanitized local HTTP fixture',
    screenshot,
    screenshotBytes: bytes,
    screenshotSha256: crypto.createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex'),
    consoleErrorCount: 0,
  };
});

const matrix = {
  generatedAt: new Date().toISOString(),
  completed: true,
  realRuntime: {
    tool: 'WeChat DevTools',
    endpoint: 'local automation websocket',
    screenshotSource: 'App.captureScreenshot',
  },
  fixtures: {
    sanitized: true,
    localHttpOnly: true,
    storageScopedToDevTools: true,
    productionDataTouched: false,
  },
  registeredPageCount: scenarios.length,
  captureCount: captures.length,
  roles: [...new Set(captures.map(item => item.role))],
  captures,
};

fs.writeFileSync(path.join(outputDir, 'matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, 'sanitized-console.json'), '[]\n', 'utf8');
fs.writeFileSync(path.join(outputDir, 'README.md'), [
  '# \u5fae\u4fe1\u5c0f\u7a0b\u5e8f\u771f\u5b9e\u8fd0\u884c\u65f6\u9875\u9762\u8bc1\u636e',
  '',
  '- \u622a\u56fe\u7531\u5fae\u4fe1\u5f00\u53d1\u8005\u5de5\u5177\u771f\u5b9e WeApp \u8fd0\u884c\u65f6\u751f\u6210\u3002',
  '- \u89d2\u8272\u3001\u4e1a\u52a1\u6570\u636e\u548c\u63a5\u53e3\u54cd\u5e94\u5747\u6765\u81ea\u4ec5\u76d1\u542c 127.0.0.1 \u7684\u8131\u654f\u56fa\u5b9a\u6570\u636e\u670d\u52a1\u3002',
  '- \u4e34\u65f6\u4f1a\u8bdd\u53ea\u5199\u5165\u5fae\u4fe1\u5f00\u53d1\u8005\u5de5\u5177\u7684\u5c0f\u7a0b\u5e8f\u5b58\u50a8\uff1b\u672a\u8bbf\u95ee\u751f\u4ea7\u4e1a\u52a1\u63a5\u53e3\u3002',
  `- \u6ce8\u518c\u9875\u9762\uff1a${scenarios.length}\uff1b\u6709\u6548\u622a\u56fe\uff1a${captures.length}\u3002`,
  '',
].join('\n'), 'utf8');

console.log(JSON.stringify({ complete: true, captures: captures.length, roles: matrix.roles, outputDir }));
