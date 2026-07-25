const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/src/routes/ops.js', 'utf-8');

assert.ok(
  source.includes('ARCHIVABLE_MAINTENANCE_TABLES'),
  'ops archive route should use an explicit maintenance-table allowlist'
);
assert.ok(
  source.includes("const ARCHIVABLE_MAINTENANCE_TABLES = ['sync_log', 'sync_audit_log']"),
  'ops archive route must not allow business base tables to be archived/deleted'
);
assert.ok(
  source.includes('business data cannot be archived from ops maintenance'),
  'ops archive route should return a clear error for business base tables'
);

console.log('ops archive safety checks passed');
