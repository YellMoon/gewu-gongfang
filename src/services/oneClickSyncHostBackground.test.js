const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('src/App.tsx', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(!app.includes('processMiniappCloudTasks'), 'renderer must not process cloud relay tasks');
assert.ok(!app.includes('publishCloudHeartbeat'), 'renderer must not publish host heartbeat');
assert.ok(!app.includes('cloudRelayHostApi'), 'renderer must not import the legacy host maintenance API');
assert.ok(!app.includes('HOST_CLOUD_TASK_POLL_INTERVAL_MS'), 'renderer must not own host task polling');
assert.ok(!app.includes('HOST_CLOUD_HEARTBEAT_INTERVAL_MS'), 'renderer must not own host heartbeat scheduling');
assert.ok(!app.includes('commitPrimaryHostLocalChanges'));
assert.ok(!app.includes('HOST_LOCAL_COMMIT_INTERVAL_MS'));
assert.ok(!app.includes("from './services/syncEngine'"));
assert.ok(!app.includes("from './services/oneClickSync"));
assert.ok(packageJson.includes('src/services/oneClickSyncHostBackground.test.js'), 'host background sync test should run in npm test');

console.log('renderer host background retirement checks passed');
