const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/browserDatabase.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(
  source.includes('createBusinessDataSafetyBackup'),
  'browser database should create a safety backup before replacing non-question-bank data'
);
assert.ok(source.includes("const { storage_state: _ignoredStorageState, sourceDeviceId: _ignoredSourceDeviceId, ownerUserId: _ignoredOwnerUserId, ...trustedQuestion } = question"),
  'question creation must discard caller supplied provenance');
assert.ok(source.includes("const { storage_state: _ignoredStorageState, sourceDeviceId: _ignoredSourceDeviceId, ownerUserId: _ignoredOwnerUserId, ...safeUpdates } = updates"),
  'question updates must not overwrite trusted provenance');
assert.ok(source.includes("from './questionProvenance.mjs'"), 'browser database must use the tested trusted provenance adapter');
assert.ok(source.includes('nativeVerified !== true') && !source.includes('questionDraftProvenance?.register'),
  'local draft authorization must fail closed and must not register renderer-selected ids');
const preload = fs.readFileSync('public/preload.js', 'utf-8');
const electronMain = fs.readFileSync('public/electron.js', 'utf-8');
assert.ok(preload.includes("exposeInMainWorld('questionDraftProvenance'") && preload.includes('issue-question-draft') && !preload.includes('register-question-draft'));
assert.ok(electronMain.includes('QuestionDraftProvenanceRegistry') && electronMain.includes('/api/auth/desktop-session') && !electronMain.includes('JWT_SECRET'));
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
