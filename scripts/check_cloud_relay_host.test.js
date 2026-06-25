const assert = require('assert');
const fs = require('fs');

const script = fs.readFileSync('scripts/check_cloud_relay_host.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(script.includes('GEWU_HOST_BASE_URL'), 'host smoke should read host base URL from env');
assert.ok(script.includes('/api/cloud-relay-host/heartbeat'), 'host smoke should publish heartbeat through host route');
assert.ok(script.includes('/api/cloud-relay-host/snapshot'), 'host smoke should publish snapshot through host route');
assert.ok(script.includes('/api/cloud-relay-host/tasks/pending'), 'host smoke should list pending cloud tasks through host route');
assert.ok(script.includes('/api/cloud-relay-host/tasks/process'), 'host smoke should process pending cloud tasks through host route');
assert.ok(packageJson.includes('scripts/check_cloud_relay_host.test.js'), 'host cloud relay smoke test should run in npm test');

console.log('cloud relay host smoke checks passed');
