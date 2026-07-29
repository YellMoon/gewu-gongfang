const assert = require('assert');
const fs = require('fs');

const client = fs.readFileSync('backend/src/services/cloudRelayClient.js', 'utf8');
const router = fs.readFileSync('backend/src/routes/cloudRelay.js', 'utf8');

assert.ok(client.includes('x-gewu-host-credential'));
assert.ok(client.includes('x-gewu-host-generation'));
assert.ok(!client.includes('x-gewu-host-token'));
assert.ok(router.includes("router.post('/tasks/claim', requireHostWrite"));
assert.ok(!router.includes("router.get('/tasks'"));
console.log('managed cloud relay configuration checks passed');
