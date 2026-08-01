const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-question-delete-http-'));
const qbRoot = path.join(tempRoot, 'question-bank');
fs.mkdirSync(path.join(qbRoot, 'assets', 'images'), { recursive: true });
fs.mkdirSync(path.join(qbRoot, 'assets', 'word-imports'), { recursive: true });
fs.mkdirSync(path.join(qbRoot, 'assets', 'exports'), { recursive: true });
fs.mkdirSync(path.join(qbRoot, 'backups'), { recursive: true });
fs.mkdirSync(path.join(qbRoot, 'questions'), { recursive: true });
fs.mkdirSync(path.join(qbRoot, '.trash'), { recursive: true });
fs.writeFileSync(path.join(qbRoot, 'manifest.json'), JSON.stringify({ storeId: 'test-store', schemaVersion: 1 }), 'utf8');
const assetFile = path.join(qbRoot, 'assets', 'images', 'kept.png');
fs.writeFileSync(assetFile, 'temporary-test-asset', 'utf8');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'question-delete-http-secret';
process.env.DB_PATH = path.join(tempRoot, 'test.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.QUESTION_BANK_ROOT = qbRoot;
process.env.GEWU_NODE_ROLE = 'primary-host';
process.env.WRITE_ROLES = 'super_admin,admin,teacher';

const { DatabaseService } = require('../database');
const service = new DatabaseService();
const now = new Date().toISOString();
const authorityId = 'test-database-authority';
service.db.prepare('INSERT INTO authority_metadata (key,value,updated_at) VALUES (?,?,?)').run('database_authority_id', authorityId, now);
service.db.prepare("INSERT INTO question_bank_store_bindings (store_id,db_authority_id,root_path,bound_by,bound_at,status) VALUES (?,?,?,?,?,'active')")
  .run('test-store', authorityId, qbRoot, 'client-super', now);
fs.writeFileSync(path.join(qbRoot, 'manifest.json'), JSON.stringify({ storeId: 'test-store', schemaVersion: 1, authorityDatabaseId: authorityId }), 'utf8');
for (const user of [
  ['host-admin', 'admin', 'approved'], ['client-super', 'super_admin', 'approved'],
  ['mini-super', 'super_admin', 'approved'], ['pending-user', 'pending', 'pending'],
  ['host-student', 'student', 'approved'],
  ['approved-teacher', 'teacher', 'approved'],
]) service.db.prepare(`INSERT INTO users (id,phone,name,role,status,login_enabled,review_status,deleted,created_at,updated_at)
 VALUES (?,?,?, ?,1,1,?,0,?,?)`).run(user[0], `${Math.random()}`.slice(2, 13), user[0], user[1], user[2], now, now);
service.db.prepare(`INSERT INTO students
  (id, name, deleted, created_at, updated_at)
  VALUES ('host-student-profile', 'host-student', 0, ?, ?)`)
  .run(now, now);
service.db.prepare(`INSERT INTO teachers
  (id, name, deleted, created_at, updated_at)
  VALUES ('approved-teacher-profile', 'approved-teacher', 0, ?, ?)`)
  .run(now, now);
service.db.prepare("UPDATE users SET student_id='host-student-profile' WHERE id='host-student'").run();
service.db.prepare("UPDATE users SET teacher_id='approved-teacher-profile' WHERE id='approved-teacher'").run();
const insertGrant = service.db.prepare(`INSERT OR IGNORE INTO user_role_grants
  (user_id, role, subject_type, subject_id, status, source, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'active', 'test', ?, ?)`);
insertGrant.run('host-admin', 'admin', null, null, now, now);
insertGrant.run('client-super', 'super_admin', null, null, now, now);
insertGrant.run('mini-super', 'super_admin', null, null, now, now);
insertGrant.run('host-student', 'student', 'student', 'host-student-profile', now, now);
insertGrant.run('approved-teacher', 'teacher', 'teacher', 'approved-teacher-profile', now, now);
service.registerSyncDevice('host-device', { deviceName: 'Host', role: 'primary-host', trusted: true, ownerUserId: 'host-admin' });
service.registerSyncDevice('client-device', { deviceName: 'Client', role: 'desktop-client', trusted: true, ownerUserId: 'client-super' });
service.registerSyncDevice('student-device', { deviceName: 'Student host session', role: 'primary-host', trusted: true, ownerUserId: 'host-student' });
service.registerSyncDevice('teacher-device', { deviceName: 'Teacher desktop', role: 'desktop-client', trusted: true, ownerUserId: 'approved-teacher' });
service.registerSyncDevice('super-host-device', { deviceName: 'Super host', role: 'primary-host', trusted: true, ownerUserId: 'miniapp-admin-13732250653' });
const insertDesktopAuthorization = service.db.prepare(`INSERT INTO desktop_device_authorizations
  (id, device_id, device_name, device_kind, user_id, public_key, key_fingerprint,
   status, source_challenge_id, last_phone_verified_at, phone_reverify_due_at,
   credential_version, row_version, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'test-public-key', ?, 'active', ?, ?,
    '2099-01-01T00:00:00.000Z', 1, 1, ?, ?)`);
for (const [deviceId, userId, deviceKind] of [
  ['host-device', 'host-admin', 'primary-host'],
  ['client-device', 'client-super', 'desktop-client'],
  ['student-device', 'host-student', 'primary-host'],
  ['teacher-device', 'approved-teacher', 'desktop-client'],
  ['super-host-device', 'miniapp-admin-13732250653', 'primary-host'],
]) {
  insertDesktopAuthorization.run(
    `authorization-${deviceId}`,
    deviceId,
    deviceId,
    deviceKind,
    userId,
    `fingerprint-${deviceId}`,
    `bootstrap-${deviceId}`,
    now,
    now,
    now
  );
}

const databaseModule = require('../database');
databaseModule.getInstance = () => service;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');
const { createDesktopSessionService } = require('../services/desktopSessionService');
const desktopSessions = createDesktopSessionService({ db: service.db, jwtSecret: process.env.JWT_SECRET });
const { createMiniappIdentityService } = require('../services/miniappIdentityService');
const miniappIdentity = createMiniappIdentityService({
  db: service.db,
  jwtSecret: process.env.JWT_SECRET,
});
const questionBank = require('../services/questionBankService');
const { commitQuestionToBoundStore, updateCommittedQuestion, createTrustedInternalStorageUpdateContext, deleteCommittedQuestion } = require('../services/questionBankStorageService');

function token(id, deviceId, tokenUse = 'desktop-session') {
  if (tokenUse === 'miniapp-session') {
    const user = service.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    return miniappIdentity.issueFormalToken(user, `miniapp-test-${id}`).token;
  }
  if (id === 'pending-user') {
    return jwt.sign({ id, deviceId, token_use: tokenUse }, process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'gewu-auth', audience: 'gewu-api' });
  }
  const user = service.db.prepare('SELECT role FROM users WHERE id=?').get(id);
  return desktopSessions.issueSession({ userId: id, deviceId, activeRole: user.role }).token;
}
async function remove(base, id, bearer, deviceId) {
  const response = await fetch(`${base}/api/question-bank/questions/${id}`, { method: 'DELETE', headers: {
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(deviceId ? { 'x-device-id': deviceId } : {}),
  }});
  return { status: response.status, body: await response.json() };
}
async function jsonRequest(base, method, url, bearer, deviceId, body) {
  const response = await fetch(`${base}${url}`, { method, headers: { 'content-type':'application/json', authorization:`Bearer ${bearer}`, 'x-device-id':deviceId }, body:JSON.stringify(body) });
  return { status:response.status, body:await response.json() };
}
function committed(id) {
  const created = questionBank.createQuestion(service.db, { id, stem: id, type: 'fill', storage_state: 'host_committed',
    assets: [{ oss_key: `question-bank/assets/images/kept.png`, file_name: 'kept.png' }] });
  commitQuestionToBoundStore(created.id, { db: service.db, tenantId: 'default', authz: {
    role:'admin', deviceTrusted:true, deviceActive:true, userApproved:true, userId:'host-admin', deviceOwnerUserId:'host-admin', isPrimaryHost:true,
  }, runtime: { nodeRole:'primary-host', tokenUse:'desktop-session', tokenDeviceId:'host-device', deviceId:'host-device', clientType:'desktop' } });
  return questionBank.getQuestion(service.db, created.id, 'default');
}

(async () => {
  const listener = createApp().listen(0);
  const base = `http://127.0.0.1:${listener.address().port}`;
  try {
    const introspection = await fetch(`${base}/api/auth/desktop-session`, { headers: { authorization: `Bearer ${token('host-admin','host-device')}`, 'x-device-id':'host-device' } });
    assert.strictEqual(introspection.status, 200);
    assert.deepStrictEqual((await introspection.json()).session, { userId:'host-admin', deviceId:'host-device', tokenUse:'desktop-session' });
    process.env.GEWU_NODE_ROLE = 'primary-host';
    const ordinaryBind = await jsonRequest(base, 'POST', '/api/question-bank/storage/bind', token('host-admin','host-device'), 'host-device', { root: qbRoot });
    assert.strictEqual(ordinaryBind.status, 403);
    const superBind = await jsonRequest(base, 'POST', '/api/question-bank/storage/bind', token('miniapp-admin-13732250653','super-host-device'), 'super-host-device', { root: qbRoot });
    assert.strictEqual(superBind.status, 200, JSON.stringify(superBind.body));
    assert.strictEqual(superBind.body.binding.idempotent, true);
    const unsafeBind = await jsonRequest(base, 'POST', '/api/question-bank/storage/bind', token('miniapp-admin-13732250653','super-host-device'), 'super-host-device', { root: path.join(tempRoot, 'other') });
    assert.strictEqual(unsafeBind.status, 403);
    process.env.GEWU_NODE_ROLE = 'desktop-client';
    const teacherCreate = await jsonRequest(base, 'POST', '/api/question-bank/questions', token('approved-teacher','teacher-device'), 'teacher-device', {
      stem:'teacher create', type:'fill', storage_state:'host_committed', committed_at:'forged', committed_by_device_id:'forged', source_device_id:'forged', owner_user_id:'forged',
    });
    assert.strictEqual(teacherCreate.status, 200);
    assert.strictEqual(teacherCreate.body.storage_state, 'local_draft');
    assert.strictEqual(teacherCreate.body.source_device_id, 'teacher-device');
    assert.strictEqual(teacherCreate.body.owner_user_id, 'approved-teacher');
    const teacherUpdate = await jsonRequest(base, 'PUT', `/api/question-bank/questions/${teacherCreate.body.id}`, token('approved-teacher','teacher-device'), 'teacher-device', {
      stem:'updated', storage_state:'host_committed', committed_at:'forged', source_device_id:'other', owner_user_id:'other',
    });
    assert.strictEqual(teacherUpdate.status, 200);
    assert.strictEqual(teacherUpdate.body.data.storage_state, 'local_draft');
    assert.strictEqual(teacherUpdate.body.data.source_device_id, 'teacher-device');
    assert.strictEqual((await jsonRequest(base,'POST','/api/question-bank/questions',token('host-student','student-device'),'student-device',{stem:'no',type:'fill'})).status,403);
    assert.strictEqual((await jsonRequest(base,'PUT',`/api/question-bank/questions/${teacherCreate.body.id}`,token('host-student','student-device'),'student-device',{stem:'no'})).status,403);

    process.env.GEWU_NODE_ROLE = 'primary-host';
    const success = committed('success');
    const syncQuestion = committed('sync-update');
    const syncAuthz = { kind:'admin', role:'admin', userId:'host-admin', deviceId:'host-device', runtimeNodeRole:'primary-host', tokenUse:'desktop-session', tokenDeviceId:'host-device', deviceTrusted:true, deviceActive:true, clientType:'desktop', userApproved:true, deviceOwnerUserId:'host-admin', isPrimaryHost:true };
    const syncChange = { id:'sync-op', table:'questions', action:'update', tenantId:'default', data:{ id:'sync-update', stem:'synced committed update' }, updatedAt:new Date().toISOString() };
    const withoutHook = service.applySyncChanges([syncChange], { deviceId:'host-device', authz:syncAuthz });
    assert.strictEqual(withoutHook.applied, 0);
    assert.strictEqual(withoutHook.errors[0].error, 'COMMITTED_QUESTION_STORAGE_UPDATE_REQUIRED');
    const internalCredential = createTrustedInternalStorageUpdateContext({ validatedAuthz: syncAuthz, hostRuntime: { runtimeNodeRole:'primary-host' } });
    assert.throws(() => createTrustedInternalStorageUpdateContext({ validatedAuthz:{...syncAuthz,deviceActive:false}, hostRuntime:{runtimeNodeRole:'primary-host'} }), error => error.code === 'TRUSTED_INTERNAL_STORAGE_ACTOR_REQUIRED');
    const withHook = service.applySyncChanges([{ ...syncChange, id:'sync-op-hook' }], { deviceId:'host-device', authz:syncAuthz, storageHooks:{ updateCommittedQuestion:({change,tenantId})=>updateCommittedQuestion(change.data.id,{db:service.db,tenantId,internalCredential,payload:change.data}) } });
    assert.strictEqual(withHook.applied, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(qbRoot,'questions','sync-update','question.json'),'utf8')).contents[0].stem,'synced committed update');
    assert.throws(() => deleteCommittedQuestion('sync-update', { db:service.db, tenantId:'default', internalCredential }), error => error.code === 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE');
    process.env.GEWU_NODE_ROLE = 'desktop-client';
    const deniedCommittedUpdate = await jsonRequest(base, 'PUT', `/api/question-bank/questions/${success.id}`, token('approved-teacher','teacher-device'), 'teacher-device', { stem: 'forbidden update' });
    assert.strictEqual(deniedCommittedUpdate.status, 403);
    assert.strictEqual(deniedCommittedUpdate.body.code, 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_UPDATE');
    process.env.GEWU_NODE_ROLE = 'primary-host';
    const committedUpdate = await jsonRequest(base, 'PUT', `/api/question-bank/questions/${success.id}`, token('host-admin','host-device'), 'host-device', { stem: 'trusted committed update' });
    assert.strictEqual(committedUpdate.status, 200);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(qbRoot, 'questions', success.id, 'question.json'), 'utf8')).contents[0].stem, 'trusted committed update');
    service.db.exec("CREATE TRIGGER fail_committed_update BEFORE INSERT ON question_contents WHEN NEW.question_id='success' BEGIN SELECT RAISE(ABORT,'forced committed update rollback'); END;");
    const failedCommittedUpdate = await jsonRequest(base, 'PUT', `/api/question-bank/questions/${success.id}`, token('host-admin','host-device'), 'host-device', { stem: 'must rollback' });
    assert.strictEqual(failedCommittedUpdate.status, 500);
    assert.strictEqual(questionBank.getQuestion(service.db, success.id, 'default').stem, 'trusted committed update');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(qbRoot, 'questions', success.id, 'question.json'), 'utf8')).contents[0].stem, 'trusted committed update');
    service.db.exec('DROP TRIGGER fail_committed_update');
    const ok = await remove(base, success.id, token('host-admin', 'host-device'), 'host-device');
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(service.db.prepare('SELECT deleted FROM questions WHERE id=?').get(success.id).deleted, 1);
    assert.ok(fs.existsSync(assetFile), 'soft delete must retain physical asset');
    const deniedRestore = await jsonRequest(base, 'POST', `/api/question-bank/questions/${success.id}/restore`, token('client-super','client-device'), 'client-device', {});
    assert.strictEqual(deniedRestore.status, 403);
    const restored = await jsonRequest(base, 'POST', `/api/question-bank/questions/${success.id}/restore`, token('host-admin','host-device'), 'host-device', {});
    assert.strictEqual(restored.status, 200);
    assert.strictEqual(service.db.prepare('SELECT deleted FROM questions WHERE id=?').get(success.id).deleted, 0);

    const studentQuestion = committed('student-success');
    service.db.prepare('UPDATE sync_devices SET owner_user_id=? WHERE id=?').run('host-student', 'student-device');
    const studentDelete = await remove(base, studentQuestion.id, token('host-student', 'student-device'), 'student-device');
    assert.strictEqual(studentDelete.status, 200);
    assert.strictEqual(service.db.prepare('SELECT deleted FROM questions WHERE id=?').get(studentQuestion.id).deleted, 1);

    const denials = [
      ['client', 'client-super', 'client-device', 'desktop-session', 'desktop-client'],
      ['miniapp', 'host-admin', 'host-device', 'miniapp-session', 'primary-host'],
      ['pending', 'pending-user', 'host-device', 'desktop-session', 'primary-host'],
    ];
    for (const [id, userId, deviceId, use, nodeRole] of denials) {
      process.env.GEWU_NODE_ROLE = nodeRole;
      const question = committed(id);
      const before = {
        q: service.db.prepare('SELECT * FROM questions WHERE id=?').get(id),
        c: service.db.prepare('SELECT * FROM question_contents WHERE question_id=?').all(id),
        a: service.db.prepare('SELECT * FROM question_assets WHERE question_id=?').all(id),
      };
      const result = await remove(base, id, token(userId, deviceId, use), deviceId);
      assert.strictEqual(result.status, id === 'pending' ? 401 : 403, id);
      assert.strictEqual(result.body.code, id === 'pending' ? 'TOKEN_INVALID' : 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE', id);
      assert.deepStrictEqual(service.db.prepare('SELECT * FROM questions WHERE id=?').get(id), before.q);
      assert.deepStrictEqual(service.db.prepare('SELECT * FROM question_contents WHERE question_id=?').all(id), before.c);
      assert.deepStrictEqual(service.db.prepare('SELECT * FROM question_assets WHERE question_id=?').all(id), before.a);
      assert.ok(fs.existsSync(assetFile));
    }
    const cloud = committed('cloud');
    const noToken = await remove(base, cloud.id, null, null);
    assert.strictEqual(noToken.status, 401);
    assert.strictEqual(service.db.prepare('SELECT deleted FROM questions WHERE id=?').get(cloud.id).deleted, 0);
  } finally {
    await new Promise(resolve => listener.close(resolve));
    service.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('question deletion HTTP tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
