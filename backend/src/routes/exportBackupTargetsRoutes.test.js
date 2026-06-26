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
assert.ok(
  source.includes("require('../services/backupArchiveService')") &&
  source.includes('archiveBackupArtifact') &&
  source.includes('GEWU_NAS_BACKUP_PATH') &&
  source.includes('GEWU_LOCAL_CACHE_PATH'),
  'backup creation should archive completed backup artifacts to configured local cache and NAS targets'
);

console.log('export backup target route checks passed');
