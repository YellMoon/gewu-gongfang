const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { createSignedAuthorityProjection } = require('../../../shared/authorityProjectionProtocol');
const { createAuthorityProjectionStoreService } = require('./authorityProjectionStoreService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_scoped_projections (
    authority_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, source_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
    document_json TEXT NOT NULL, signature TEXT NOT NULL, generated_at TEXT NOT NULL,
    PRIMARY KEY(authority_id,user_id,role)
  );
`);
const keyPair = crypto.generateKeyPairSync('ed25519');
const projection = createSignedAuthorityProjection({
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  userId: 'user-1',
  role: 'student',
  sourceVersion: 3,
  generatedAt: '2026-07-28T08:00:00.000Z',
  payload: { schedules: [], courses: [], assets: [], questionPreviews: [] },
  privateKey: keyPair.privateKey,
});
const store = createAuthorityProjectionStoreService({ db });
assert.equal(store.publish(projection).sourceVersion, 3);
assert.deepStrictEqual(store.read({
  authorityId: 'authority-1',
  userId: 'user-1',
  role: 'student',
}), projection);
assert.equal(store.publish(projection).replayed, true);
assert.throws(
  () => store.publish({ ...projection, sourceVersion: 2 }),
  error => error.code === 'AUTHORITY_PROJECTION_VERSION_STALE'
);
assert.throws(
  () => store.publish({ ...projection, signature: Buffer.from('different').toString('base64') }),
  error => error.code === 'AUTHORITY_PROJECTION_VERSION_CONFLICT'
);

console.log('authorityProjectionStoreService tests passed');
