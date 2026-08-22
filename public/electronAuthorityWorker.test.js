const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('public/electron.js', 'utf8');
for (const marker of [
  'createAuthorityHostRuntime', 'createAuthorityCommandSource', 'createAuthorityProjectionWorker',
  'createHostCommandWorker', 'hostTaskWakeup', 'primaryHost', 'hostBaseUrl', 'lanBaseUrl',
]) assert.ok(!source.includes(marker), `unified Electron main must not contain ${marker}`);
assert.ok(source.includes("listen(port, '127.0.0.1'"));
assert.ok(source.includes('createDesktopAuthorityRuntime'));
assert.ok(source.includes('durableRelayBaseUrl'));
assert.ok(source.includes('desktop-authority:confirm-and-submit'));

console.log('unified Electron authority runtime checks passed');
