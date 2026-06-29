const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/browserDatabase.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(
  source.includes('createBusinessDataSafetyBackup'),
  'browser database should create a safety backup before replacing non-question-bank data'
);
assert.ok(
  source.includes('business_data_safety_backups_v1'),
  'browser database should store non-question-bank safety backups in localStorage'
);
assert.ok(
  source.includes('before-importAllData') &&
    source.includes('before-replaceSchedules') &&
    source.includes('before-deleteSchedule'),
  'import, bulk schedule replace, and schedule delete should create safety backups'
);
assert.ok(
  packageJson.includes('node src/services/browserDatabaseSafety.test.js'),
  'browser database safety test should run in npm test'
);

console.log('browser database safety checks passed');
