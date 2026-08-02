const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { createSignedAuthorityProjection } = require('../../../shared/authorityProjectionProtocol');
const { createMiniappAuthorityProjectionHandler } = require('../routes/miniappAuthorityProjection');
const { createAuthorityProjectionPublisherService } = require('./authorityProjectionPublisherService');
const { createAuthorityProjectionStoreService } = require('./authorityProjectionStoreService');

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
    id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, status TEXT NOT NULL,
    host_public_key TEXT
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
db.prepare("INSERT INTO primary_host_epochs VALUES('epoch-1','authority-1','active',NULL)").run();
const keyPair = crypto.generateKeyPairSync('ed25519');
db.prepare("UPDATE primary_host_epochs SET host_public_key=? WHERE id='epoch-1'")
  .run(keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString());
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

  const legacyOverbroadStudent = createSignedAuthorityProjection({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    userId: 'user-1',
    role: 'student',
    sourceVersion: 5,
    generatedAt: now,
    payload: {
      questionPreviews: [],
      schedules: [
        { id: 'own', studentIds: ['student-1'] },
        { id: 'peer', studentIds: ['student-2'] },
      ],
    },
    privateKey: keyPair.privateKey,
  });
  db.prepare(`UPDATE authority_scoped_projections
    SET payload_hash=?,document_json=?,signature=?,generated_at=?
    WHERE authority_id=? AND user_id=? AND role=?`)
    .run(
      legacyOverbroadStudent.payloadHash,
      JSON.stringify(legacyOverbroadStudent),
      legacyOverbroadStudent.signature,
      legacyOverbroadStudent.generatedAt,
      legacyOverbroadStudent.authorityId,
      legacyOverbroadStudent.userId,
      legacyOverbroadStudent.role,
    );
  const sameVersionPolicyRefresh = await service.materializeAll({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  const refreshedStudent = sameVersionPolicyRefresh.documents.find(document => document.role === 'student');
  assert.deepStrictEqual(refreshedStudent.payload.schedules.map(item => item.id), ['own'],
    'the current projector must recompute scope even when the source version is unchanged');
  assert.notStrictEqual(refreshedStudent.signature, legacyOverbroadStudent.signature,
    'a same-version policy change must replace the previously signed overbroad projection');
  assert.strictEqual(refreshedStudent.sourceVersion, 6,
    'a changed policy output must advance the projection version to avoid signed same-version equivocation');

  db.prepare(`UPDATE authority_projection_versions SET version=6
    WHERE authority_id='authority-1' AND host_epoch_id='epoch-1'`).run();
  const offlinePrepareService = createAuthorityProjectionPublisherService({
    db,
    now: () => '2026-07-28T08:00:30.000Z',
    loadSource: () => ({
      questionPreviews: [{ id: 'offline-local-question' }],
      schedules: [],
      courses: [],
      assets: [],
    }),
    signProjection: input => createSignedAuthorityProjection({
      ...input,
      privateKey: keyPair.privateKey,
    }),
    prepareRemote: async () => {
      throw Object.assign(new Error('cloud offline'), { code: 'CLOUD_OFFLINE' });
    },
  });
  const offlineLocal = await offlinePrepareService.materializeAll({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  assert.equal(offlineLocal.materialized, 2,
    'local projections must materialize without invoking remote preparation');
  assert.equal(
    JSON.parse(db.prepare(`SELECT document_json FROM authority_scoped_projections
      WHERE authority_id='authority-1' AND user_id='user-1' AND role='student'`).get().document_json)
      .sourceVersion,
    7,
    'the local store must advance while the cloud is unavailable',
  );

  db.prepare(`UPDATE authority_projection_versions SET version=8
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

  const failClosedService = createAuthorityProjectionPublisherService({
    db,
    now: () => '2026-07-28T08:03:00.000Z',
    loadSource: () => ({
      questionPreviews: [{ id: 'policy-changed-question' }],
      schedules: [{ id: 'policy-changed-own', studentIds: ['student-1'] }],
      courses: [],
      assets: [],
    }),
    signProjection: input => {
      if (input.role === 'student') {
        throw Object.assign(new Error('signer unavailable'), { code: 'SIGNER_UNAVAILABLE' });
      }
      return createSignedAuthorityProjection({ ...input, privateKey: keyPair.privateKey });
    },
  });
  const failClosed = await failClosedService.materializeAll({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  assert.equal(failClosed.failed, 1);
  assert.deepStrictEqual(failClosed.failures, [{
    userId: 'user-1', role: 'student', code: 'SIGNER_UNAVAILABLE',
  }]);
  const failClosedStore = createAuthorityProjectionStoreService({ db });
  assert.strictEqual(failClosedStore.read({
    authorityId: 'authority-1', userId: 'user-1', role: 'student',
  }), null, 'a failed active-scope re-sign must invalidate the old sensitive document');
  assert.ok(failClosedStore.read({
    authorityId: 'authority-1', userId: 'user-1', role: 'visitor',
  }), 'one failed scope must not invalidate another successfully materialized scope');
  const facade = createMiniappAuthorityProjectionHandler({
    db,
    projectionStore: failClosedStore,
  });
  const facadeResponse = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  facade({
    authz: {
      tokenUse: 'miniapp-session', accountState: 'formal', activeRole: 'student', userId: 'user-1',
    },
  }, facadeResponse);
  assert.equal(facadeResponse.statusCode, 404,
    'the miniapp facade must not expose the old projection after re-sign failure');
  assert.equal(facadeResponse.body.code, 'AUTHORITY_PROJECTION_NOT_FOUND');

  db.prepare(`UPDATE authority_role_bindings SET status='revoked'
    WHERE authority_id='authority-1' AND user_id='user-1' AND role='student'`).run();
  const afterStudentRevocation = await service.materializeAll({
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
  });
  assert.deepStrictEqual(afterStudentRevocation.documents.map(document => document.role), ['visitor']);
  assert.deepStrictEqual(
    db.prepare(`SELECT role FROM authority_scoped_projections
      WHERE authority_id='authority-1' AND user_id='user-1' ORDER BY role`).all(),
    [{ role: 'visitor' }],
    'materialization must prune a revoked role projection from the local store',
  );
  console.log('authorityProjectionPublisherService tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
