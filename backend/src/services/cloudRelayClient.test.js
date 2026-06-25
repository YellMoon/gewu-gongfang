const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/src/services/cloudRelayClient.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(source.includes('publishHeartbeat'), 'cloud relay client should publish heartbeat');
assert.ok(source.includes('publishSnapshot'), 'cloud relay client should publish snapshot');
assert.ok(source.includes('fetchPendingTasks'), 'cloud relay client should fetch pending tasks');
assert.ok(packageJson.includes('backend/src/services/cloudRelayClient.test.js'), 'cloud relay client test should run in npm test');

console.log('cloudRelayClient checks passed');
