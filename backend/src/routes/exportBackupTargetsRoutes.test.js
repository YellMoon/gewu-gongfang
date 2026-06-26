const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('backend/src/routes/export.js', 'utf-8');

assert.ok(
  source.includes("require('../services/questionBankBackupTargetService')"),
  'export routes should use questionBankBackupTargetService'
);
assert.ok(
  source.includes("router.get('/backups/targets/status'"),
  'export routes should expose backup target status'
);
assert.ok(
  source.includes('inspectBackupTargets') &&
  source.includes('localCache') &&
  source.includes('nasBackup'),
  'backup target status should include local cache and NAS backup checks'
);

console.log('export backup target route checks passed');
