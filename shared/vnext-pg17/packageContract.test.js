'use strict';

const assert = require('assert');
const pkg = require('../../package.json');

assert.strictEqual(pkg.scripts['test:vnext-pg17'], 'node shared/vnext-pg17/runPg17IntegrationTests.js');
assert.strictEqual(
  pkg.scripts['test:vnext-control-plane-target'],
  'npm run test:vnext-migration && npm run test:vnext-pg17',
);
assert.match(pkg.devDependencies.pg, /^\d+\.\d+\.\d+$/);
assert.ok(!pkg.devDependencies.pg.startsWith('^') && !pkg.devDependencies.pg.startsWith('~'));

console.log('vNext PG17 package contract checks passed');
