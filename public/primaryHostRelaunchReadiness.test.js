'use strict';

const assert = require('assert');
const { createPrimaryHostRelaunchReadiness } = require('./primaryHostRelaunchReadiness');

const files = new Map();
const fsImpl = {
  existsSync: file => files.has(file),
  readFileSync: file => files.get(file),
  writeFileSync: (file, value) => files.set(file, String(value)),
  renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  unlinkSync: file => files.delete(file),
};
let serial = 0;
const readiness = createPrimaryHostRelaunchReadiness({
  userDataPath: 'C:\\isolated-profile',
  fsImpl,
  now: () => '2026-07-27T00:00:00.000Z',
  randomId: () => `launch-${++serial}`,
});
const started = readiness.beginLaunch();
assert.equal(started.state, 'starting');
assert.match(readiness.filePath, /isolated-profile/);
const relaunch = readiness.requestRelaunch();
assert.equal(relaunch.state, 'relaunch-requested');
const afterRestart = readiness.beginLaunch();
assert.equal(afterRestart.previousState, 'relaunch-requested');
const ready = readiness.markReady({ host: '0.0.0.0', port: 60462 });
assert.equal(ready.state, 'ready');
assert.equal(readiness.read().port, 60462);
assert.equal(readiness.read().launchId, afterRestart.launchId, 'the readiness marker must belong to the fresh process');
console.log('primary host relaunch readiness tests passed');
