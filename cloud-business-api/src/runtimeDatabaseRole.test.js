'use strict';

const assert = require('assert');
const { resolveRuntimeDatabaseUser } = require('./runtimeDatabaseRole');

assert.strictEqual(resolveRuntimeDatabaseUser(undefined), 'gewu_cloud_schedule_reader');
assert.strictEqual(resolveRuntimeDatabaseUser(''), 'gewu_cloud_schedule_reader');
assert.strictEqual(resolveRuntimeDatabaseUser('  gewu_cloud_schedule_reader  '), 'gewu_cloud_schedule_reader');
assert.strictEqual(resolveRuntimeDatabaseUser('custom_runtime_role'), 'custom_runtime_role');
assert.throws(() => resolveRuntimeDatabaseUser('invalid role'), /CLOUD_RUNTIME_DATABASE_USER_INVALID/u);

console.log('cloud runtime database role checks passed');
