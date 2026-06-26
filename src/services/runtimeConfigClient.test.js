const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/runtimeConfigClient.ts', 'utf-8');

assert.ok(source.includes("runtime-config:get"), 'client should call runtime-config:get');
assert.ok(source.includes("runtime-config:set"), 'client should call runtime-config:set');
assert.ok(source.includes('questionBankCandidatePaths'), 'client runtime config should include hotplug candidate paths');
assert.ok(source.includes('questionBankStoreId'), 'client runtime config should include question bank store id');
assert.ok(source.includes('localCachePath'), 'client runtime config should include local cache path');
assert.ok(source.includes('nasBackupPath'), 'client runtime config should include NAS backup path');
assert.ok(source.includes("dialog:select-folder"), 'client should call dialog:select-folder');
assert.ok(source.includes('getRuntimeConfig'), 'client should export getRuntimeConfig');
assert.ok(source.includes('saveRuntimeConfig'), 'client should export saveRuntimeConfig');
