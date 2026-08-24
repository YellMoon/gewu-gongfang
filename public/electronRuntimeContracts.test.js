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
assert.ok(electronSource.includes('resolveDevelopmentRenderer'), 'Electron must use the tested development renderer boundary');
assert.ok(preloadSource.includes('preloadLoginFixtureEnabled'), 'preload must use the tested fixture bridge boundary');
assert.ok(electronSource.includes("'seal-question-asset'"), 'Electron must expose the NAS asset sealing IPC');
assert.ok(preloadSource.includes('sealAsset: input => ipcRenderer.invoke(\'seal-question-asset\', input)'), 'preload must expose only the asset sealing capability');
console.log('unified electron runtime contract checks passed');
