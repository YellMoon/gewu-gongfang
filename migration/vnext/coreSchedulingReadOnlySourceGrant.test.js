'use strict';

const assert = require('assert');

const {
  CORE_SCHEDULING_REAL_SOURCE_RELATIONS,
} = require('./sourceTableCatalog');
const {
  createCoreSchedulingReadOnlySourceGrant,
  requireCoreSchedulingReadOnlySourceGrant,
} = require('./coreSchedulingReadOnlySourceGrant');

const SHA = 'a'.repeat(64);

assert.deepStrictEqual(
  CORE_SCHEDULING_REAL_SOURCE_RELATIONS,
  Object.freeze(['tenants', 'institutions', 'schools', 'rooms', 'teachers', 'students', 'courses', 'schedules']),
  'the real-source gate must expose exactly the approved eight scheduling relations and no question or asset relation'
);

assert.throws(
  () => createCoreSchedulingReadOnlySourceGrant({ databasePath: 'C:\\unsafe\\legacy.db' }),
  error => error?.code === 'MIGRATION_CORE_SCHEDULING_SOURCE_GRANT_INVALID',
  'a source path must never be a public source-grant input'
);

let getterReads = 0;
const accessorInput = {
  snapshotId: 'snapshot-synthetic-1',
  sourceIdentitySha256: SHA,
  get openReadOnlyDatabase() { getterReads += 1; return () => null; },
  readSourceIdentity: () => SHA,
};
assert.throws(
  () => createCoreSchedulingReadOnlySourceGrant(accessorInput),
  error => error?.code === 'MIGRATION_CORE_SCHEDULING_SOURCE_GRANT_INVALID',
  'an accessor must fail before it runs'
);
assert.strictEqual(getterReads, 0, 'grant validation must not invoke accessor input');

assert.throws(
  () => createCoreSchedulingReadOnlySourceGrant(new Proxy({
    snapshotId: 'snapshot-synthetic-1', sourceIdentitySha256: SHA,
    openReadOnlyDatabase: () => null, readSourceIdentity: () => SHA,
  }, {})),
  error => error?.code === 'MIGRATION_CORE_SCHEDULING_SOURCE_GRANT_INVALID',
  'a Proxy cannot mint a source-read grant'
);

const opener = () => Object.freeze({ purpose: 'fictional-only' });
const identityReader = () => SHA;
const grant = createCoreSchedulingReadOnlySourceGrant(Object.freeze({
  snapshotId: 'snapshot-synthetic-1',
  sourceIdentitySha256: SHA,
  openReadOnlyDatabase: opener,
  readSourceIdentity: identityReader,
}));
assert.deepStrictEqual(Reflect.ownKeys(grant), [], 'the grant must not expose a path, source identity, opener, or generic database facade');
assert.ok(Object.isFrozen(grant), 'the grant token must be frozen');
assert.deepStrictEqual(
  requireCoreSchedulingReadOnlySourceGrant(grant),
  Object.freeze({ snapshotId: 'snapshot-synthetic-1', sourceIdentitySha256: SHA, openReadOnlyDatabase: opener, readSourceIdentity: identityReader }),
  'only the exact runtime-issued opaque token may resolve its private source configuration'
);
assert.throws(
  () => requireCoreSchedulingReadOnlySourceGrant(Object.freeze({})),
  error => error?.code === 'MIGRATION_CORE_SCHEDULING_SOURCE_GRANT_INVALID',
  'a lookalike frozen object cannot substitute for the runtime-issued source grant'
);

console.log('core scheduling read-only source grant checks passed');
