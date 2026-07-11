const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-question-import-http-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'question-import-http-secret';
process.env.DB_PATH = path.join(tempRoot, 'test.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.GEWU_NODE_ROLE = 'primary-host';
process.env.WRITE_ROLES = 'super_admin,admin,teacher';

const { DatabaseService } = require('../database');
const service = new DatabaseService();
const now = new Date().toISOString();
service.db.prepare(`INSERT INTO users
  (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
  VALUES (?, ?, ?, 'teacher', 1, 1, 'approved', 0, ?, ?)`)
  .run('import-teacher', '13900000001', 'Import Teacher', now, now);
service.registerSyncDevice('import-teacher-device', {
  deviceName: 'Import Teacher Desktop', role: 'desktop-client', trusted: true, ownerUserId: 'import-teacher',
});

const databaseModule = require('../database');
databaseModule.getInstance = () => service;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

const bearer = jwt.sign(
  { id: 'import-teacher', deviceId: 'import-teacher-device', token_use: 'desktop-session' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256', issuer: 'gewu-auth', audience: 'gewu-api' }
);

async function request(base, url, authorization) {
  const response = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization: `Bearer ${authorization}`, 'x-device-id': 'import-teacher-device' } : {}),
    },
    body: JSON.stringify(url.endsWith('/check') ? {
      source_type: 'manual',
      file_name: 'teacher-import.json',
      items: [{ stem: 'teacher import attribution', type: 'fill', answer: 'verified' }],
    } : {}),
  });
  return { status: response.status, body: await response.json() };
}

(async () => {
  const listener = createApp().listen(0);
  const base = `http://127.0.0.1:${listener.address().port}`;
  try {
    const prepared = await request(base, '/api/question-bank/imports/check', bearer);
    assert.strictEqual(prepared.status, 200);
    const batchId = prepared.body.id;
    assert.ok(batchId);

    const before = service.db.prepare('SELECT COUNT(*) AS count FROM questions').get().count;
    const unauthorized = await request(base, `/api/question-bank/imports/${batchId}/commit`);
    assert.ok([401, 403].includes(unauthorized.status), `unexpected unauthenticated status ${unauthorized.status}`);
    assert.strictEqual(service.db.prepare('SELECT COUNT(*) AS count FROM questions').get().count, before);

    const committed = await request(base, `/api/question-bank/imports/${batchId}/commit`, bearer);
    assert.strictEqual(committed.status, 200);
    assert.strictEqual(committed.body.data.commit_result.imported_items, 1);
    const questionId = committed.body.data.commit_result.question_ids[0];
    const question = service.db.prepare(
      'SELECT source_device_id, owner_user_id FROM questions WHERE id = ?'
    ).get(questionId);
    assert.deepStrictEqual(question, {
      source_device_id: 'import-teacher-device', owner_user_id: 'import-teacher',
    });
  } finally {
    await new Promise(resolve => listener.close(resolve));
    service.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('question import commit HTTP tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
