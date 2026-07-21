'use strict';

const assert = require('assert');

const {
  loadRemovalCheckConfig,
  runReviewDemoRemovalCheck,
  sanitizeFailure,
} = require('./check_review_demo');

const GATEWAY_URL = 'https://review.example.test';
const BACKEND_URL = 'https://review.example.test/scheduling';

assert.deepStrictEqual(
  loadRemovalCheckConfig({
    MINIAPP_REVIEW_BASE_URL: GATEWAY_URL,
    MINIAPP_REAL_API_BASE_URL: BACKEND_URL,
  }),
  { gatewayUrl: GATEWAY_URL, backendUrl: BACKEND_URL },
);

for (const env of [
  {},
  { MINIAPP_REVIEW_BASE_URL: 'http://review.example.test', MINIAPP_REAL_API_BASE_URL: BACKEND_URL },
  { MINIAPP_REVIEW_BASE_URL: GATEWAY_URL, MINIAPP_REAL_API_BASE_URL: 'https://other.example.test/scheduling' },
  { MINIAPP_REVIEW_BASE_URL: GATEWAY_URL, MINIAPP_REAL_API_BASE_URL: `${GATEWAY_URL}/other` },
]) {
  assert.throws(() => loadRemovalCheckConfig(env), /removal check configuration is invalid/);
}

function response(status, body) {
  return {
    status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => body,
  };
}

function fakeFetchFactory(options = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ method, path: url.pathname, hasSignal: Boolean(init.signal) });
    if (options.failAt === url.pathname) return response(200, { success: true, token: 'must-not-be-logged' });
    if (url.pathname === '/api/auth/review-demo' || url.pathname.startsWith('/api/review-demo')) {
      return response(410, { success: false, code: 'REVIEW_DEMO_REMOVED' });
    }
    if (url.pathname === '/scheduling/api/experience/questions') {
      return response(401, { success: false, code: 'UNAUTHORIZED' });
    }
    throw new Error(`unexpected request ${method} ${url.pathname}`);
  };
  return { calls, fetchImpl };
}

(async () => {
  const good = fakeFetchFactory();
  const lines = [];
  const result = await runReviewDemoRemovalCheck({
    env: {
      MINIAPP_REVIEW_BASE_URL: GATEWAY_URL,
      MINIAPP_REAL_API_BASE_URL: BACKEND_URL,
    },
    fetchImpl: good.fetchImpl,
    log: line => lines.push(line),
  });
  assert.deepStrictEqual(result, { gatewayTombstone: true, backendOwnsExperience: true });
  assert.deepStrictEqual(good.calls.map(call => [call.method, call.path]), [
    ['POST', '/api/auth/review-demo'],
    ['GET', '/api/review-demo/questions'],
    ['POST', '/api/review-demo/tasks'],
    ['GET', '/scheduling/api/experience/questions'],
  ]);
  assert.ok(good.calls.every(call => call.hasSignal), 'every public probe must have a timeout signal');
  assert.ok(lines.some(line => line.includes('review-demo removal check passed')));

  const bad = fakeFetchFactory({ failAt: '/api/review-demo/tasks' });
  await assert.rejects(
    () => runReviewDemoRemovalCheck({
      env: { MINIAPP_REVIEW_BASE_URL: GATEWAY_URL, MINIAPP_REAL_API_BASE_URL: BACKEND_URL },
      fetchImpl: bad.fetchImpl,
      log: () => {},
    }),
    /gateway task tombstone: unexpected HTTP status/,
  );
  const sanitized = sanitizeFailure(new Error('secret=must-not-leak token=must-not-leak'));
  assert.strictEqual(sanitized, 'review-demo removal check failed: unexpected error');
  assert.ok(!sanitized.includes('must-not-leak'));
  console.log('review-demo removal check script tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
