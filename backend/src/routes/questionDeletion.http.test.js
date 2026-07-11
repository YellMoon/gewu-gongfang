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
for (const user of [
  ['host-admin', 'admin', 'approved'], ['client-super', 'super_admin', 'approved'],
  ['mini-super', 'super_admin', 'approved'], ['pending-user', 'pending', 'pending'],
  ['host-student', 'student', 'approved'],
  ['approved-teacher', 'teacher', 'approved'],
]) service.db.prepare(`INSERT INTO users (id,phone,name,role,status,login_enabled,review_status,deleted,created_at,updated_at)
 VALUES (?,?,?, ?,1,1,?,0,?,?)`).run(user[0], `${Math.random()}`.slice(2, 13), user[0], user[1], user[2], now, now);
service.registerSyncDevice('host-device', { deviceName: 'Host', role: 'primary-host', trusted: true, ownerUserId: 'host-admin' });
service.registerSyncDevice('client-device', { deviceName: 'Client', role: 'desktop-client', trusted: true, ownerUserId: 'client-super' });
service.registerSyncDevice('student-device', { deviceName: 'Student host session', role: 'primary-host', trusted: true, ownerUserId: 'host-student' });
service.registerSyncDevice('teacher-device', { deviceName: 'Teacher desktop', role: 'desktop-client', trusted: true, ownerUserId: 'approved-teacher' });

const databaseModule = require('../database');
databaseModule.getInstance = () => service;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');
const questionBank = require('../services/questionBankService');

function token(id, deviceId, tokenUse = 'desktop-session') {
  return jwt.sign({ id, deviceId, token_use: tokenUse }, process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'gewu-auth', audience: 'gewu-api' });
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
  return questionBank.markQuestionHostCommitted(service.db, created.id, {
    runtimeNodeRole:'primary-host', tokenUse:'desktop-session', tokenDeviceId:'host-device',
    deviceId:'host-device', deviceTrusted:true,
  });
}

(async () => {
  const listener = createApp().listen(0);
  const base = `http://127.0.0.1:${listener.address().port}`;
  try {
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
    const ok = await remove(base, success.id, token('host-admin', 'host-device'), 'host-device');
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(service.db.prepare('SELECT deleted FROM questions WHERE id=?').get(success.id).deleted, 1);
    assert.ok(fs.existsSync(assetFile), 'soft delete must retain physical asset');

    const studentQuestion = committed('student-success');
    service.db.prepare('UPDATE sync_devices SET owner_user_id=? WHERE id=?').run('host-student', 'student-device');
    const studentDelete = await remove(base, studentQuestion.id, token('host-student', 'student-device'), 'student-device');
    assert.strictEqual(studentDelete.status, 200);
    assert.strictEqual(service.db.prepare('SELECT deleted FROM questions WHERE id=?').get(studentQuestion.id).deleted, 1);

    const denials = [
      ['client', 'client-super', 'client-device', 'desktop-session', 'desktop-client'],
      ['miniapp', 'mini-super', 'host-device', 'miniapp-session', 'primary-host'],
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
      assert.strictEqual(result.status, 403, id);
      assert.strictEqual(result.body.code, id === 'pending' ? 'FORBIDDEN' : 'HOST_DESKTOP_REQUIRED_FOR_COMMITTED_DELETE', id);
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
