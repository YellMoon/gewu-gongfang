const assert = require('assert');
const { createAuthRefreshRuntime, extractRefreshToken } = require('./miniappAuthRefreshRuntime');
const { createAuthSessionRuntime } = require('./miniappApiSessionRuntime');

const normalIdentity = { id: 'admin-1', role: 'admin', user_type: 'admin' };
const reviewIdentity = {
  id: 'review-demo:admin:session-a', role: 'admin', user_type: 'admin', review_status: 'approved',
  status: 1, login_enabled: 1, is_review_demo: true, read_only: true, review_demo_session_id: 'session-a',
};

function createHarness(overrides = {}) {
  const state = { token: 'normal-old', identity: normalIdentity, generation: 1, ...overrides };
  const sessionRuntime = createAuthSessionRuntime({
    readToken: () => state.token,
    readIdentity: () => state.identity,
    readGeneration: () => state.generation,
    writeGeneration: value => { state.generation = value; },
  });
  return { state, sessionRuntime };
}

function createRuntime(harness, requestRefresh) {
  return createAuthRefreshRuntime({
    sessionRuntime: harness.sessionRuntime,
    writeToken: value => { harness.state.token = value; },
    requestRefresh,
  });
}

async function main() {
  assert.strictEqual(extractRefreshToken({ success: true, token: ' gateway-token ' }), 'gateway-token', 'the real gateway top-level refresh token must be accepted');
  assert.strictEqual(extractRefreshToken({ success: false, token: 'poison' }), '', 'failed refresh responses must never yield a token');
  assert.strictEqual(extractRefreshToken({ success: true, token: 123 }), '', 'refresh tokens must be non-empty strings');
  assert.strictEqual(extractRefreshToken({ success: true, token: '   ' }), '');

  const stale = createHarness();
  let resolveStaleRefresh;
  let staleRequests = 0;
  const staleRuntime = createRuntime(stale, async originalToken => {
    staleRequests += 1;
    assert.strictEqual(originalToken, 'normal-old');
    return new Promise(resolve => { resolveStaleRefresh = resolve; });
  });
  const stalePending = staleRuntime.refresh();
  assert.strictEqual(staleRequests, 1);
  stale.state.token = 'review-token';
  stale.state.identity = reviewIdentity;
  stale.state.generation += 1;
  resolveStaleRefresh('normal-new');
  assert.strictEqual(await stalePending, false, 'stale normal refresh must not commit after review login');
  assert.strictEqual(stale.state.token, 'review-token', 'stale refresh must preserve the newer review token');
  assert.strictEqual(await staleRuntime.refresh(), false, 'review identity must never enter normal refresh');
  assert.strictEqual(staleRequests, 1);

  const shared = createHarness();
  let resolveSharedRefresh;
  let sharedRequests = 0;
  const sharedRuntime = createRuntime(shared, async () => {
    sharedRequests += 1;
    return new Promise(resolve => { resolveSharedRefresh = resolve; });
  });
  const sharedOne = sharedRuntime.refresh();
  const sharedTwo = sharedRuntime.refresh();
  assert.strictEqual(sharedRequests, 1, 'same generation, identity, and token must share one in-flight refresh');
  resolveSharedRefresh('normal-new');
  assert.strictEqual(await sharedOne, true);
  assert.strictEqual(await sharedTwo, true);
  assert.strictEqual(shared.state.token, 'normal-new');
  assert.strictEqual(shared.state.generation, 1, 'normal token refresh must not advance session generation');

  const relogin = createHarness();
  const refreshResolvers = [];
  let reloginRequests = 0;
  const reloginRuntime = createRuntime(relogin, async () => {
    reloginRequests += 1;
    return new Promise(resolve => refreshResolvers.push(resolve));
  });
  const oldLoginRefresh = reloginRuntime.refresh();
  relogin.state.generation += 1;
  const newLoginRefresh = reloginRuntime.refresh();
  assert.strictEqual(reloginRequests, 2, 'a new generation must not reuse an old in-flight refresh even when identity and token text match');
  refreshResolvers[0]('old-generation-token');
  refreshResolvers[1]('new-generation-token');
  assert.strictEqual(await oldLoginRefresh, false);
  assert.strictEqual(await newLoginRefresh, true);
  assert.strictEqual(relogin.state.token, 'new-generation-token');

  const failed = createHarness();
  let failedWrites = 0;
  const failedRuntime = createAuthRefreshRuntime({
    sessionRuntime: failed.sessionRuntime,
    writeToken: () => { failedWrites += 1; },
    requestRefresh: async () => extractRefreshToken({ success: false, token: 'must-not-commit' }),
  });
  assert.strictEqual(await failedRuntime.refresh(), false, 'a rejected gateway refresh must fail before logout handling');
  assert.strictEqual(failedWrites, 0);

  console.log('miniapp auth refresh runtime checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
