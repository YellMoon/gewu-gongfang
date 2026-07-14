const assert = require('assert');
const { createAuthRefreshRuntime } = require('./miniappAuthRefreshRuntime');

const normalIdentity = { id: 'admin-1', role: 'admin', user_type: 'admin' };
const reviewIdentity = {
  id: 'review-demo:admin:session-a', role: 'admin', user_type: 'admin', review_status: 'approved',
  status: 1, login_enabled: 1, is_review_demo: true, read_only: true, review_demo_session_id: 'session-a',
};

async function main() {
  let token = 'normal-old';
  let identity = normalIdentity;
  let resolveRefresh;
  let requests = 0;
  const runtime = createAuthRefreshRuntime({
    readToken: () => token,
    readIdentity: () => identity,
    writeToken: value => { token = value; },
    requestRefresh: async originalToken => {
      requests += 1;
      assert.strictEqual(originalToken, 'normal-old');
      return new Promise(resolve => { resolveRefresh = resolve; });
    },
  });

  const pending = runtime.refresh();
  assert.strictEqual(requests, 1);
  token = 'review-token';
  identity = reviewIdentity;
  assert.strictEqual(runtime.isCurrentSession('normal-old', false), false, 'an old normal request must not invalidate a newer review session');
  assert.strictEqual(runtime.isCurrentSession('review-token', true), true, 'the current review request may handle its own expiry');
  resolveRefresh('normal-new');
  assert.strictEqual(await pending, false, 'stale normal refresh must not commit after a review login switch');
  assert.strictEqual(token, 'review-token', 'stale refresh must preserve the newer review token');

  token = 'normal-old';
  identity = normalIdentity;
  const normalRuntime = createAuthRefreshRuntime({
    readToken: () => token,
    readIdentity: () => identity,
    writeToken: value => { token = value; },
    requestRefresh: async originalToken => originalToken === 'normal-old' ? 'normal-new' : '',
  });
  assert.strictEqual(await normalRuntime.refresh(), true, 'unchanged normal session should still refresh');
  assert.strictEqual(token, 'normal-new');

  token = 'review-token';
  identity = reviewIdentity;
  let reviewRequests = 0;
  const reviewRuntime = createAuthRefreshRuntime({
    readToken: () => token,
    readIdentity: () => identity,
    writeToken: () => { throw new Error('review refresh must never write'); },
    requestRefresh: async () => { reviewRequests += 1; return 'forbidden'; },
  });
  assert.strictEqual(await reviewRuntime.refresh(), false, 'review identity must never enter normal refresh');
  assert.strictEqual(reviewRequests, 0);
  assert.strictEqual(token, 'review-token');

  console.log('miniapp auth refresh runtime checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
