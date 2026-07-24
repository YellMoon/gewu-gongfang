const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('src/App.tsx', 'utf-8');
const hostApi = fs.readFileSync('src/services/cloudRelayHostApi.ts', 'utf-8');
const hostRoute = fs.readFileSync('backend/src/routes/cloudRelayHost.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(app.includes('processMiniappCloudTasks'), 'App should process cloud relay tasks in host background mode');
assert.ok(app.includes('publishCloudHeartbeat'), 'App should publish host heartbeat in background mode');
assert.ok(
  app.includes("config.nodeRole !== 'primary-host'") || app.includes("nodeRole === 'primary-host'"),
  'background cloud processing should only run on primary host'
);
assert.ok(app.includes('setInterval'), 'background cloud processing should poll after startup');
assert.ok(
  app.includes('HOST_CLOUD_TASK_POLL_INTERVAL_MS = 5 * 1000'),
  'desktop identity relay tasks should be claimed frequently enough for interactive login'
);
assert.ok(
  app.includes('HOST_CLOUD_HEARTBEAT_INTERVAL_MS = 60 * 1000'),
  'fast task polling must not increase the heartbeat publication rate'
);
assert.ok(
  app.includes('processMiniappCloudTasks({ skipMaintenance: true })'),
  'fast identity task polling should skip heavyweight periodic storage maintenance'
);
assert.ok(
  hostApi.includes('processMiniappCloudTasks(body') && hostApi.includes("postHost('/api/cloud-relay-host/tasks/process', body)"),
  'the host API client should forward the fast-poll maintenance option'
);
assert.ok(
  hostRoute.includes('skipMaintenance: req.body?.skipMaintenance === true'),
  'the local host route should honor the authenticated fast-poll maintenance option'
);
assert.ok(packageJson.includes('src/services/oneClickSyncHostBackground.test.js'), 'host background sync test should run in npm test');

console.log('one-click host background checks passed');
