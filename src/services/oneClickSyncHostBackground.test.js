const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('src/App.tsx', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(app.includes('processMiniappCloudTasks'), 'App should process cloud relay tasks in host background mode');
assert.ok(app.includes('publishCloudHeartbeat'), 'App should publish host heartbeat in background mode');
assert.ok(
  app.includes("config.nodeRole !== 'primary-host'") || app.includes("nodeRole === 'primary-host'"),
  'background cloud processing should only run on primary host'
);
assert.ok(app.includes('setInterval'), 'background cloud processing should poll after startup');
assert.ok(packageJson.includes('src/services/oneClickSyncHostBackground.test.js'), 'host background sync test should run in npm test');

console.log('one-click host background checks passed');
