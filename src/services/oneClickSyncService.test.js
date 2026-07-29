const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const filename of [
  'oneClickSyncService.mjs',
  'oneClickSyncTransports.mjs',
  'primaryHostLocalCommitter.mjs',
  'syncApi.ts',
]) {
  assert.strictEqual(
    fs.existsSync(path.join(__dirname, filename)),
    false,
    `${filename} must remain retired after the authority cutover`,
  );
}

console.log('legacy desktop sync implementation retirement checks passed');
