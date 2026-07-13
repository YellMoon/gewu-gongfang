const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

assert.ok(fs.readFileSync('package.json', 'utf8').includes('backend/src/routes/cloudRelay.http.test.js'), 'backend HTTP relay contract test must run in test:backend');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-backend-relay-http-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'backend-relay-http-secret';
process.env.GEWU_CLOUD_RELAY_HOST_TOKEN = 'backend-host-secret';
process.env.DB_PATH = path.join(tempRoot, 'relay.db');
process.env.READ_DB_PATH = process.env.DB_PATH;

const { DatabaseService } = require('../database');
const service = new DatabaseService();
const now = new Date().toISOString();
for (const id of ['relay-u1', 'relay-u2']) {
  service.db.prepare(`INSERT INTO users
    (id, phone, name, role, status, login_enabled, review_status, deleted, created_at, updated_at)
    VALUES (?, ?, ?, 'student', 1, 1, 'approved', 0, ?, ?)`)
    .run(id, id === 'relay-u1' ? '13900000021' : '13900000022', id, now, now);
}
const databaseModule = require('../database');
databaseModule.getInstance = () => service;
delete require.cache[require.resolve('../app')];
const { createApp } = require('../app');

const token = id => jwt.sign({ id }, process.env.JWT_SECRET, { algorithm: 'HS256' });

(async () => {
  const listener = createApp().listen(0);
  const base = `http://127.0.0.1:${listener.address().port}/api/cloud`;
  const call = (url, options = {}) => fetch(base + url, {
    ...options,
    signal: AbortSignal.timeout(3000),
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const userHeaders = id => ({ authorization: `Bearer ${token(id)}` });
  const hostHeaders = { 'x-gewu-host-token': 'backend-host-secret' };
  try {
    assert.strictEqual((await call('/host/heartbeat', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ hostDeviceId: 'backend-host' }) })).status, 200);
    const firstBody = { protocolVersion: 2, taskType: 'paper-export-pdf', targetHostDeviceId: 'backend-host', payload: { questionIds: ['q1'] } };
    const first = await call('/tasks', { method: 'POST', headers: { ...userHeaders('relay-u1'), 'x-idempotency-key': 'backend-idem-1' }, body: JSON.stringify(firstBody) });
    assert.strictEqual(first.status, 200);
    const firstTask = (await first.json()).task;
    const conflict = await call('/tasks', { method: 'POST', headers: { ...userHeaders('relay-u1'), 'x-idempotency-key': 'backend-idem-1' }, body: JSON.stringify({ ...firstBody, payload: { questionIds: ['q2'] } }) });
    assert.strictEqual(conflict.status, 409, 'different request bodies must reach durable idempotency hashing instead of replaying the first HTTP response');

    assert.strictEqual((await call('/tasks/missing/result', { headers: userHeaders('relay-u1') })).status, 404, 'missing task results must match gateway 404 semantics');
    assert.strictEqual((await call(`/tasks/${firstTask.id}/result`, { headers: userHeaders('relay-u2') })).status, 404, 'non-owner task results must fail closed with gateway-compatible 404 semantics');

    service.db.prepare("INSERT INTO miniapp_tasks (id,task_type,status,payload,created_by,created_at,updated_at,protocol_version) VALUES ('backend-legacy-explicit','paper-export-pdf','pending_host','{}','relay-u1',?,?,1)").run(now, now);
    const explicitPoll = await call('/tasks?status=pending_host&hostDeviceId=backend-host&leaseMs=1000', { headers: hostHeaders });
    const explicitTask = (await explicitPoll.json()).tasks.find(task => task.id === 'backend-legacy-explicit');
    assert.ok(explicitTask?.claimToken);
    assert.strictEqual((await call('/tasks/backend-legacy-explicit/complete', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ success: true, hostDeviceId: 'wrong-host', claimToken: explicitTask.claimToken, expectedRowVersion: explicitTask.row_version, result: {} }) })).status, 409);
    assert.strictEqual((await call('/tasks/backend-legacy-explicit/complete', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ success: true, hostDeviceId: 'backend-host', claimToken: explicitTask.claimToken, expectedRowVersion: explicitTask.row_version, result: {} }) })).status, 200);

    service.db.prepare("INSERT INTO miniapp_tasks (id,task_type,status,payload,created_by,created_at,updated_at,protocol_version) VALUES ('backend-legacy-shared','paper-export-word','pending_host','{}','relay-u1',?,?,1)").run(now, now);
    const [sharedA, sharedB] = await Promise.all([
      call('/tasks?status=pending_host', { headers: hostHeaders }),
      call('/tasks?status=pending_host', { headers: hostHeaders }),
    ]);
    const appearances = [await sharedA.json(), await sharedB.json()].flatMap(body => body.tasks).filter(task => task.id === 'backend-legacy-shared');
    assert.strictEqual(appearances.length, 1);
    assert.strictEqual((await call('/tasks/backend-legacy-shared/complete', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ success: true, result: {} }) })).status, 200);

    assert.strictEqual((await call('/tasks/claim', { method: 'POST', headers: { 'x-gewu-host-token': 'wrong' }, body: JSON.stringify({ hostDeviceId: 'backend-host' }) })).status, 403);
  } finally {
    await new Promise(resolve => listener.close(resolve));
    service.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('backend cloud relay HTTP contract checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
