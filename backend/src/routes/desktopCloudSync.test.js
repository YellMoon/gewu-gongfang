const assert = require('assert');
const fs = require('fs');

const cloudRelay = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf8');
const hostRelay = fs.readFileSync('backend/src/routes/cloudRelayHost.js', 'utf8');
const packageJson = fs.readFileSync('package.json', 'utf8');

assert.ok(!cloudRelay.includes("router.post('/desktop-sync"));
assert.ok(!hostRelay.includes("task.task_type === 'desktop-sync'"));
assert.ok(packageJson.includes('backend/src/routes/desktopCloudSync.test.js'));
console.log('desktop cloud sync retirement checks passed');
