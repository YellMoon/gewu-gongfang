const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { createSignedAuthorityProjection } = require('../../../shared/authorityProjectionProtocol');
const { createAuthorityProjectionPublisherService } = require('./authorityProjectionPublisherService');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE authority_accounts (
    user_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE authority_role_bindings (
    binding_id TEXT PRIMARY KEY, authority_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, subject_id TEXT, status TEXT NOT NULL, grant_version INTEGER NOT NULL
  );
  CREATE TABLE authority_projection_versions (
    authority_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL, version INTEGER NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(authority_id,host_epoch_id)
  );
  CREATE TABLE primary_host_epochs (
    id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE authority_scoped_projections (
    authority_id TEXT NOT NULL, host_epoch_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, source_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
    document_json TEXT NOT NULL, signature TEXT NOT NULL, generated_at TEXT NOT NULL,
    PRIMARY KEY(authority_id,user_id,role)
  );
`);
const now = '2026-07-28T08:00:00.000Z';
db.prepare("INSERT INTO authority_accounts VALUES('user-1','authority-1','active',?,?)").run(now, now);
db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_id,status,grant_version)
  VALUES('binding-1','authority-1','user-1','student','student-1','active',1)`).run();
db.prepare(`INSERT INTO authority_projection_versions
  (authority_id,host_epoch_id,version,updated_at) VALUES('authority-1','epoch-1',5,?)`).run(now);
db.prepare("INSERT INTO primary_host_epochs VALUES('epoch-1','authority-1','active')").run();
const keyPair = crypto.generateKeyPairSync('ed25519');
const remote = [];
const prepared = [];
const service = createAuthorityProjectionPublisherService({
  db,
  now: () => now,
  loadSource: () => ({
    questionPreviews: Array.from({ length: 12 }, (_, index) => ({ id: `q${index}` })),
    schedules: [
      { id: 'own', studentIds: ['student-1'] },
      { id: 'peer', studentIds: ['student-2'] },
    ],
    courses: [],
    assets: [],
  }),
  signProjection: input => createSignedAuthorityProjection({
    ...input,
    privateKey: keyPair.privateKey,
  }),
  prepareRemote: async target => {
    prepared.push(target);
  },
  publishRemote: async projection => {
    remote.push(projection);
  },
});

(async () => {
  const result = await service.publishAll({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  assert.equal(result.published, 2, 'visitor and active student projections should be published');
  assert.deepStrictEqual(prepared, [{ authorityId: 'authority-1', hostEpochId: 'epoch-1' }]);
  assert.equal(remote.length, 2);
  const visitor = remote.find(item => item.role === 'visitor');
  const student = remote.find(item => item.role === 'student');
  assert.equal(visitor.payload.questionPreviews.length, 10);
  assert.deepStrictEqual(student.payload.schedules.map(item => item.id), ['own']);
  assert.equal(student.sourceVersion, 5);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM authority_scoped_projections').get().count,
    2
  );

  db.prepare(`UPDATE authority_projection_versions SET version=6
    WHERE authority_id='authority-1' AND host_epoch_id='epoch-1'`).run();
  let retryClock = '2026-07-28T08:01:00.000Z';
  let failRemote = true;
  const retryDocuments = [];
  const retryService = createAuthorityProjectionPublisherService({
    db,
    now: () => retryClock,
    loadSource: () => ({
      questionPreviews: [{ id: 'retry-question' }],
      schedules: [],
      courses: [],
      assets: [],
    }),
    signProjection: input => createSignedAuthorityProjection({
      ...input,
      privateKey: keyPair.privateKey,
    }),
    publishRemote: async projection => {
      retryDocuments.push(projection);
      if (failRemote) throw Object.assign(new Error('temporary cloud failure'), { code: 'TEMPORARY_CLOUD_FAILURE' });
    },
  });
  const failedAttempt = await retryService.publishAll({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  assert.equal(failedAttempt.failed, 2);
  failRemote = false;
  retryClock = '2026-07-28T08:02:00.000Z';
  const recoveredAttempt = await retryService.publishAll({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  assert.equal(recoveredAttempt.published, 2, 'same-version remote retry should reuse the stored document');
  assert.equal(recoveredAttempt.failed, 0);
  assert.equal(retryDocuments.length, 4);
  assert.equal(retryDocuments[0].signature, retryDocuments[2].signature);
  assert.equal(retryDocuments[1].signature, retryDocuments[3].signature);
  console.log('authorityProjectionPublisherService tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
