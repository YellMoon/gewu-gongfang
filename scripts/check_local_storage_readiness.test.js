const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'check_local_storage_readiness.js'), 'utf-8');

assert.ok(source.includes('gewugongfang.config.json'), 'script should read the runtime config file');
assert.ok(source.includes('inspectBackupTargets'), 'script should inspect local cache and NAS backup targets');
assert.ok(source.includes('findQuestionBankStore'), 'script should detect hotplugged question bank stores');
assert.ok(source.includes('QUESTION_BANK_STORE_ID'), 'script should report the expected question bank store id');
assert.ok(source.includes('process.exitCode = 1'), 'script should fail when required local storage is unavailable');

console.log('local storage readiness script checks passed');
