const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function requestJson(origin, pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-miniapp-authority-http-'));
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  jwtSecret: process.env.JWT_SECRET,
  nodeEnv: process.env.NODE_ENV,
};
process.env.DB_PATH = path.join(workspace, 'authority.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.JWT_SECRET = 'miniapp-authority-http-test-secret';
process.env.NODE_ENV = 'production';

const { DatabaseService } = require('../database');
const database = new DatabaseService();
const db = database.db;
const now = '2026-07-28T00:00:00.000Z';
const hostKey = crypto.generateKeyPairSync('ed25519');
const hostPublicKey = hostKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
db.prepare(`INSERT INTO authority_metadata(key,value,updated_at)
  VALUES('database_authority_id','authority-miniapp-http',?)`).run(now);
db.prepare(`INSERT INTO users
  (id,wechat_openid,phone,phone_normalized,name,role,identity_kind,status,login_enabled,
   review_status,auth_version,deleted,created_at,updated_at)
  VALUES('visitor-http','wx-visitor-http','13800138000','13800138000','Visitor',
    'visitor','visitor',1,1,'approved',1,0,?,?)`).run(now, now);
db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
  VALUES('visitor-http','authority-miniapp-http','active',?,?)`).run(now, now);
db.pragma('foreign_keys = OFF');
db.prepare(`INSERT INTO primary_host_epochs
  (id,generation,device_id,user_id,authorization_id,status,activation_reason,source_epoch_id,
   challenge_id,db_instance_digest,schema_version,store_id,db_authority_id,host_credential_hash,
   host_public_key,credential_version,row_version,created_at,updated_at,activated_at,retired_at)
  VALUES('epoch-miniapp-http',1,'host-miniapp-http','visitor-http','authorization-http',
    'active','bootstrap',NULL,'challenge-http','digest-http',1,'store-http',
    'authority-miniapp-http','host-hash',?,1,1,?,?,?,NULL)`)
  .run(hostPublicKey, now, now, now);
db.pragma('foreign_keys = ON');

const {
  createSignedAuthorityProjection,
} = require('../../../shared/authorityProjectionProtocol');
const {
  createAuthorityProjectionStoreService,
} = require('../services/authorityProjectionStoreService');
const signedVisitorProjection = createSignedAuthorityProjection({
  authorityId: 'authority-miniapp-http',
  hostEpochId: 'epoch-miniapp-http',
  userId: 'visitor-http',
  role: 'visitor',
  sourceVersion: 7,
  generatedAt: now,
  payload: {
    questionPreviews: [{
      id: 'question-preview-1',
      title: 'Sanitized preview',
      subject: 'Math',
    }],
  },
  privateKey: hostKey.privateKey,
});
createAuthorityProjectionStoreService({ db }).publish(signedVisitorProjection);

db.prepare(`INSERT INTO users
  (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,
   review_status,auth_version,deleted,created_at,updated_at)
  VALUES('admin-http','13900139000','13900139000','Admin','admin','admin',1,1,'approved',1,0,?,?)`)
  .run(now, now);
db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
  VALUES('admin-http','authority-miniapp-http','active',?,?)`).run(now, now);
db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
  VALUES('binding-admin-http','authority-miniapp-http','admin-http','admin',NULL,NULL,'active',1,?,?)`)
  .run(now, now);
db.prepare(`INSERT INTO users
  (id,phone,phone_normalized,name,role,identity_kind,status,login_enabled,
   review_status,auth_version,deleted,created_at,updated_at)
  VALUES('student-http','13900139001','13900139001','Student','student','student',1,1,
    'approved',1,0,?,?)`).run(now, now);
db.prepare(`INSERT INTO authority_accounts(user_id,authority_id,status,created_at,updated_at)
  VALUES('student-http','authority-miniapp-http','active',?,?)`).run(now, now);
db.prepare(`INSERT INTO authority_role_bindings
  (binding_id,authority_id,user_id,role,subject_type,subject_id,status,grant_version,created_at,updated_at)
  VALUES('binding-student-http','authority-miniapp-http','student-http','student',NULL,
    NULL,'active',1,?,?)`).run(now, now);
const signedAdminProjection = createSignedAuthorityProjection({
  authorityId: 'authority-miniapp-http',
  hostEpochId: 'epoch-miniapp-http',
  userId: 'admin-http',
  role: 'admin',
  sourceVersion: 7,
  generatedAt: now,
  payload: { students: [{ id: 'student-admin-projection' }] },
  privateKey: hostKey.privateKey,
});
createAuthorityProjectionStoreService({ db }).publish(signedAdminProjection);

const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const token = createMiniappIdentityService({
  db,
  jwtSecret: process.env.JWT_SECRET,
  now: () => new Date(now),
  uuid: () => 'miniapp-session-http',
}).issueVisitorToken(db.prepare("SELECT * FROM users WHERE id='visitor-http'").get()).token;
const adminToken = createMiniappIdentityService({
  db,
  jwtSecret: process.env.JWT_SECRET,
  now: () => new Date(now),
  uuid: () => 'miniapp-session-admin-http',
}).issueFormalToken(db.prepare("SELECT * FROM users WHERE id='admin-http'").get()).token;
const studentToken = createMiniappIdentityService({
  db,
  jwtSecret: process.env.JWT_SECRET,
  now: () => new Date(now),
  uuid: () => 'miniapp-session-student-http',
}).issueFormalToken(db.prepare("SELECT * FROM users WHERE id='student-http'").get()).token;

const databaseModule = require('../database');
databaseModule.getInstance = () => database;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

(async () => {
  const server = createApp().listen(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-idempotency-key': 'miniapp-role-http-1',
  };
  try {
    const submitted = await requestJson(origin, '/api/miniapp/applications', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestedRole: 'student',
      }),
    });
    assert.strictEqual(submitted.status, 200, JSON.stringify(submitted.body));
    assert.strictEqual(submitted.body.application.requestedRole, 'student');
    assert.strictEqual(submitted.body.application.state, 'submitted');
    assert.strictEqual(submitted.body.command.status, 'committed', JSON.stringify(submitted.body));

    const command = db.prepare('SELECT * FROM authority_command_ledger WHERE command_id=?')
      .get(submitted.body.command.id);
    assert.strictEqual(command.command_type, 'role-application.submit.v1');
    assert.strictEqual(command.actor_user_id, 'visitor-http');
    assert.strictEqual(command.status, 'committed');
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) count FROM miniapp_role_applications').get().count,
      0,
      'new miniapp role requests must never write the legacy provisioning table',
    );

    const replayed = await requestJson(origin, '/api/miniapp/applications', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestedRole: 'student',
      }),
    });
    assert.strictEqual(replayed.status, 200, JSON.stringify(replayed.body));
    assert.strictEqual(replayed.body.command.id, submitted.body.command.id);
    assert.strictEqual(replayed.body.command.replayed, true);

    const mine = await requestJson(origin, '/api/miniapp/applications/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(mine.status, 200, JSON.stringify(mine.body));
    assert.strictEqual(mine.body.state, 'submitted');
    assert.strictEqual(mine.body.application.commandId, submitted.body.command.id);

    const visitorTeacherApplication = await requestJson(origin, '/api/miniapp/applications', {
      method: 'POST',
      headers: { ...headers, 'x-idempotency-key': 'miniapp-role-http-visitor-teacher' },
      body: JSON.stringify({ requestedRole: 'teacher' }),
    });
    assert.strictEqual(visitorTeacherApplication.status, 200, JSON.stringify(visitorTeacherApplication.body));
    assert.strictEqual(visitorTeacherApplication.body.application.requestedRole, 'teacher');

    const formalSubmitted = await requestJson(origin, '/api/miniapp/applications', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${studentToken}`,
        'content-type': 'application/json',
        'x-idempotency-key': 'miniapp-role-http-formal-student',
      },
      body: JSON.stringify({ requestedRole: 'teacher' }),
    });
    assert.strictEqual(formalSubmitted.status, 200, JSON.stringify(formalSubmitted.body));
    const formalCommand = db.prepare('SELECT * FROM authority_command_ledger WHERE command_id=?')
      .get(formalSubmitted.body.command.id);
    assert.strictEqual(formalCommand.actor_user_id, 'student-http');
    assert.strictEqual(formalCommand.command_type, 'role-application.submit.v1');

    const adminSelfApplication = await requestJson(origin, '/api/miniapp/applications', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        'x-idempotency-key': 'miniapp-role-http-admin-self',
      },
      body: JSON.stringify({ requestedRole: 'student' }),
    });
    assert.strictEqual(adminSelfApplication.status, 403);
    assert.strictEqual(adminSelfApplication.body.code, 'MINIAPP_ROLE_APPLICATION_SESSION_FORBIDDEN');

    const forbidden = await requestJson(origin, '/api/miniapp/applications', {
      method: 'POST',
      headers: { ...headers, 'x-idempotency-key': 'miniapp-role-http-admin' },
      body: JSON.stringify({ requestedRole: 'admin' }),
    });
    assert.strictEqual(forbidden.status, 403);
    assert.strictEqual(forbidden.body.code, 'MINIAPP_ROLE_APPLICATION_FORBIDDEN');

    const miniappAdminGrant = await requestJson(origin, '/api/miniapp/applications/admin', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ userId: 'visitor-http' }),
    });
    assert.strictEqual(miniappAdminGrant.status, 403);
    assert.strictEqual(miniappAdminGrant.body.code, 'MINIAPP_ROLE_APPLICATION_SESSION_FORBIDDEN');

    const projection = await requestJson(origin, '/api/miniapp/projection', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(projection.status, 200, JSON.stringify(projection.body));
    assert.deepStrictEqual(projection.body.projection, signedVisitorProjection);
    assert.deepStrictEqual(
      projection.body.projection.payload.questionPreviews.map(item => item.id),
      ['question-preview-1'],
    );

    const ignoredCrossUserSelector = await requestJson(
      origin,
      '/api/miniapp/projection?userId=somebody-else&role=super_admin',
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.strictEqual(ignoredCrossUserSelector.status, 200);
    assert.strictEqual(ignoredCrossUserSelector.body.projection.userId, 'visitor-http');
    assert.strictEqual(ignoredCrossUserSelector.body.projection.role, 'visitor');

    const formalProjection = await requestJson(
      origin,
      '/api/miniapp/projection?userId=visitor-http&role=visitor',
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    assert.strictEqual(formalProjection.status, 403, JSON.stringify(formalProjection.body));
    assert.strictEqual(formalProjection.body.code, 'MINIAPP_AUTHORITY_PROJECTION_SESSION_REQUIRED');

    db.prepare(`UPDATE authority_scoped_projections
      SET document_json=json_set(document_json,'$.payload.questionPreviews[0].title','tampered')
      WHERE authority_id='authority-miniapp-http' AND user_id='visitor-http' AND role='visitor'`).run();
    const tamperedProjection = await requestJson(origin, '/api/miniapp/projection', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.strictEqual(tamperedProjection.status, 400);
    assert.strictEqual(tamperedProjection.body.code, 'AUTHORITY_PROJECTION_PAYLOAD_HASH_INVALID');

    console.log('miniapp authority applications HTTP tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    if (previous.dbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous.dbPath;
    if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
    else process.env.READ_DB_PATH = previous.readDbPath;
    if (previous.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous.jwtSecret;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
