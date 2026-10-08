'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(__dirname + '/navigationContext.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exported = {};
new Function('exports', source)(exported);
assert.deepEqual(exported.normalizeNavigationTarget('system-params'), { page: 'my-account', context: { section: 'software-update' } });
assert.deepEqual(exported.normalizeNavigationTarget('identity-devices'), { page: 'my-account', context: { section: 'devices' } });
assert.deepEqual(exported.normalizeNavigationTarget({ page: 'my-account', context: { section: 'devices' } }), { page: 'my-account', context: { section: 'devices' } });
assert.equal(exported.normalizeNavigationTarget('cloud-sync').page, 'cloud-sync', 'sync must retain its global panel rather than settings');
console.log('personal center aliases and sync navigation passed');
