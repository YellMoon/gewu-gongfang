'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-review-demo-removed-'));
process.env.GATEWAY_DB_PATH = path.join(workspace, 'gateway.db');
process.env.JWT_SECRET = 'review-demo-removed-http-secret-at-least-32-bytes';

const { closeDatabase, getDb, initDatabase } = require('../db/database');
const createApp = require('../app');

initDatabase();
const server = createApp().listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function request(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

function assertRemoved(response, label) {
  assert.strictEqual(response.status, 410, `${label} must stay permanently removed`);
  assert.deepStrictEqual(response.body, {
    success: false,
    code: 'REVIEW_DEMO_REMOVED',
    error: 'Legacy review demo has been removed; use the scheduling backend experience APIs',
  });
}

(async () => {
  const tasksBefore = getDb().prepare('SELECT COUNT(*) count FROM miniapp_tasks').get().count;

  assertRemoved(
    await request('POST', '/api/auth/review-demo', { code: 'legacy-value-must-not-work', role: 'student' }),
    'legacy login',
  );

  const removedRoutes = [
    ['GET', '/api/review-demo/questions'],
    ['POST', '/api/review-demo/tasks'],
    ['GET', '/api/review-demo/tasks/task-1/result'],
    ['POST', '/api/review-demo/tasks/task-1/cancel'],
    ['GET', '/api/review-demo/artifacts/artifact-1'],
    ['DELETE', '/api/review-demo/not-a-route'],
  ];
  for (const [method, route] of removedRoutes) {
    assertRemoved(await request(method, route, method === 'POST' ? {} : undefined), `${method} ${route}`);
  }

  const tasksAfter = getDb().prepare('SELECT COUNT(*) count FROM miniapp_tasks').get().count;
  assert.strictEqual(tasksAfter, tasksBefore, 'removed review-demo routes must not mutate gateway task data');
  console.log('legacy review-demo HTTP tombstone checks passed');
})().finally(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDatabase();
  fs.rmSync(workspace, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
