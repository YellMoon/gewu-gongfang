const assert = require('assert');
const fs = require('fs');

const schema = fs.readFileSync('gateway/src/db/schema.sql', 'utf-8');
const route = fs.readFileSync('gateway/src/routes/cloudRelay.js', 'utf-8');
const app = fs.readFileSync('gateway/src/app.js', 'utf-8');

assert.ok(schema.includes('host_heartbeats'), 'schema should include host_heartbeats');
assert.ok(schema.includes('readonly_snapshots'), 'schema should include readonly_snapshots');
assert.ok(schema.includes('miniapp_tasks'), 'schema should include miniapp_tasks');
assert.ok(route.includes('/host/heartbeat'), 'cloud relay should expose host heartbeat');
assert.ok(route.includes('/snapshots/publish'), 'cloud relay should expose snapshot publish');
assert.ok(route.includes('/snapshots/read'), 'cloud relay should expose snapshot read');
assert.ok(route.includes('/tasks'), 'cloud relay should expose miniapp tasks');
assert.ok(app.includes("require('./routes/cloudRelay')"), 'gateway app should mount cloud relay');

console.log('cloudRelay route checks passed');
