const assert = require('assert');
const fs = require('fs');

const permission = fs.readFileSync('miniapp/src/utils/permission.ts', 'utf-8');
const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');

assert.ok(permission.includes('readonlyModules'), 'miniapp permission should define readonlyModules');
assert.ok(permission.includes('allowedWriteTasks'), 'miniapp permission should define allowedWriteTasks');
assert.ok(api.includes('createMiniappTask'), 'miniapp API should create allowed cloud tasks');
assert.ok(api.includes('readCloudSnapshot'), 'miniapp API should read cloud snapshots');

console.log('miniapp access policy checks passed');
