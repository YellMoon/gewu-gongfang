'use strict';

const assert = require('assert');
const { reviewDemoGuard } = require('./reviewDemoGuard');

function run({ method = 'GET', path = '/api/permissions/my', review = true } = {}) {
  let nextCalled = false;
  let response = null;
  const req = { method, path, originalUrl: path, authz: review ? { isReviewDemo: true } : { isReviewDemo: false } };
  const res = {
    status(status) { response = { status }; return this; },
    json(body) { response.body = body; return this; },
  };
  reviewDemoGuard(req, res, () => { nextCalled = true; });
  return { nextCalled, response };
}

assert.strictEqual(run({ review: false, method: 'POST', path: '/api/cloud/tasks' }).nextCalled, true);
assert.strictEqual(run({ method: 'GET', path: '/api/permissions/my' }).nextCalled, true);
assert.strictEqual(run({ method: 'GET', path: '/api/modules' }).nextCalled, true);
assert.strictEqual(run({ method: 'GET', path: '/api/cloud/snapshots/read?snapshotType=full' }).nextCalled, true);
assert.strictEqual(run({ method: 'GET', path: '/api/cloud/snapshots/questions' }).nextCalled, true);
assert.strictEqual(run({ method: 'POST', path: '/api/review-demo/tasks' }).nextCalled, true);

for (const candidate of [
  { method: 'GET', path: '/api/admin/users' },
  { method: 'GET', path: '/api/cloud/host/status' },
  { method: 'POST', path: '/api/cloud/tasks' },
  { method: 'PATCH', path: '/api/admin/users/1/review' },
  { method: 'POST', path: '/api/desktop-pairing/start' },
]) {
  const result = run(candidate);
  assert.strictEqual(result.nextCalled, false, `${candidate.method} ${candidate.path} must be blocked`);
  assert.strictEqual(result.response.status, 403);
  assert.strictEqual(result.response.body.code, candidate.method === 'GET' ? 'REVIEW_DEMO_ROUTE_FORBIDDEN' : 'REVIEW_DEMO_READ_ONLY');
}

console.log('review demo guard checks passed');
