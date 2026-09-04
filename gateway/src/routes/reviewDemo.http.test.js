'use strict';

const assert = require('assert');
const createApp = require('../app');

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

  console.log('legacy review-demo HTTP tombstone checks passed');
})().finally(async () => {
  await new Promise(resolve => server.close(resolve));
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
