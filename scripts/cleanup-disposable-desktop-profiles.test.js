'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const modulePath = './cleanup-disposable-desktop-profiles';
const cleanupSource = fs.readFileSync(path.join(__dirname, 'cleanup-disposable-desktop-profiles.js'), 'utf8');
assert.ok(cleanupSource.includes('process.pid') && cleanupSource.includes('process.ppid'),
  'the cleanup process and its invoking shell must not be classified as target desktop processes');
assert.doesNotThrow(() => require(modulePath));
const { assertDisposableRoot, cleanupDisposableRoot } = require(modulePath);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-real-desktop-two-app-'));
fs.writeFileSync(path.join(root, 'marker.txt'), 'isolated', 'utf8');
assert.strictEqual(assertDisposableRoot(root), path.resolve(root));
assert.throws(
  () => assertDisposableRoot(path.join(os.tmpdir(), 'not-a-gewu-profile')),
  /DISPOSABLE_PROFILE_ROOT_REQUIRED/,
);
assert.deepStrictEqual(
  cleanupDisposableRoot(root, { listProcesses: () => [] }),
  { root: path.resolve(root), removed: true },
);
assert.strictEqual(fs.existsSync(root), false);

const liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-packaged-single-instance-'));
assert.throws(
  () => cleanupDisposableRoot(liveRoot, { listProcesses: () => [{ pid: 42 }] }),
  /DISPOSABLE_PROFILE_PROCESS_STILL_RUNNING/,
);
assert.strictEqual(fs.existsSync(liveRoot), true);
fs.rmSync(liveRoot, { recursive: true, force: true });

console.log('disposable desktop profile cleanup checks passed');
