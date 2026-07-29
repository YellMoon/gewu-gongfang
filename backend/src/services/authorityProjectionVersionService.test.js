const assert = require('assert');
const Database = require('better-sqlite3');
const { createAuthorityProjectionVersionService } = require('./authorityProjectionVersionService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_projection_versions (
    authority_id TEXT NOT NULL,
    host_epoch_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (authority_id, host_epoch_id)
  );
`);
let clock = '2026-07-28T00:00:00.000Z';
const service = createAuthorityProjectionVersionService({ db, now: () => clock });

assert.strictEqual(service.next({ authorityId: 'authority-1', hostEpochId: 'epoch-1' }), 1);
clock = '2026-07-28T00:00:01.000Z';
assert.strictEqual(service.next({ authorityId: 'authority-1', hostEpochId: 'epoch-1' }), 2);
assert.strictEqual(service.next({ authorityId: 'authority-1', hostEpochId: 'epoch-2' }), 1);

assert.throws(() => db.transaction(() => {
  service.next({ authorityId: 'authority-rollback', hostEpochId: 'epoch-1' });
  throw new Error('rollback');
})(), /rollback/);
assert.strictEqual(
  db.prepare("SELECT version FROM authority_projection_versions WHERE authority_id='authority-rollback'").get(),
  undefined,
  'a failed authority command transaction must not consume a projection version',
);

console.log('authorityProjectionVersionService tests passed');
