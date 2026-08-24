'use strict';

const assert = require('assert');
const fs = require('fs');

const electronSource = fs.readFileSync('public/electron.js', 'utf8');
const preloadSource = fs.readFileSync('public/preload.js', 'utf8');
for (const marker of ['primaryHost', 'primary-host', 'hostBaseUrl', 'primaryHostRuntime']) {
  assert.ok(!electronSource.includes(marker), `Electron main must not retain ${marker}`);
  assert.ok(!preloadSource.includes(marker), `preload must not retain ${marker}`);
}
assert.ok(electronSource.includes("listen(port, '127.0.0.1'"));
assert.ok(!electronSource.includes('remote-debugging-port='));
assert.ok(
  electronSource.includes("process.env.GEWU_E2E_DESKTOP_LOGIN_FIXTURE === '1'"),
  'Electron development runtime must require an explicit flag before loading the login fixture',
);
assert.ok(
  electronSource.includes("'http://localhost:3000/?__desktopLoginFixture=1'"),
  'Electron development runtime must expose the localhost-only login fixture URL',
);
assert.ok(
  preloadSource.includes("process.env.NODE_ENV === 'development'"),
  'preload fixture isolation must be restricted to development mode',
);
assert.ok(
  preloadSource.includes("process.env.GEWU_E2E_DESKTOP_LOGIN_FIXTURE === '1'"),
  'preload must require the explicit fixture flag before yielding its read-only bridges',
);
assert.ok(electronSource.includes("'seal-question-asset'"), 'Electron must expose the NAS asset sealing IPC');
assert.ok(preloadSource.includes('sealAsset: input => ipcRenderer.invoke(\'seal-question-asset\', input)'), 'preload must expose only the asset sealing capability');
console.log('unified electron runtime contract checks passed');
