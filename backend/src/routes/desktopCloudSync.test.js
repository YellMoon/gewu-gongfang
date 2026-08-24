const assert = require('assert');
const fs = require('fs');

const cloudRelay = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf8');
const packageJson = fs.readFileSync('package.json', 'utf8');

assert.ok(!cloudRelay.includes("router.post('/desktop-sync"));
assert.ok(!fs.existsSync('backend/src/routes/cloudRelayHost.js'));
assert.ok(packageJson.includes('backend/src/routes/desktopCloudSync.test.js'));
console.log('desktop cloud sync retirement checks passed');
