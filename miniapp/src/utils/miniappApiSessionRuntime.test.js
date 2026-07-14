const assert = require('assert');

let sessionModule = {};
try {
  sessionModule = require('./miniappApiSessionRuntime');
} catch (_error) {
  // The first RED should be an assertion that names the missing behavior boundary.
}

const {
  clearAuthenticatedSession,
  createApiResponseCoordinator,
  createAuthSessionRuntime,
  createNormalSessionCommitter,
  createSessionBoundOperation,
} = sessionModule;

const normalIdentity = { id: 'admin-1', role: 'admin', user_type: 'admin' };
const reviewIdentity = {
  id: 'review-demo:admin:session-a', role: 'admin', user_type: 'admin', review_status: 'approved',
  status: 1, login_enabled: 1, is_review_demo: true, read_only: true, review_demo_session_id: 'session-a',
};

function createSessionState(overrides = {}) {
  const state = { token: 'normal-a', identity: normalIdentity, generation: 7, ...overrides };
  const runtime = createAuthSessionRuntime({
    readToken: () => state.token,
    readIdentity: () => state.identity,
    readGeneration: () => state.generation,
    writeGeneration: value => { state.generation = value; },
  });
  return { runtime, state };
}

async function main() {
  assert.strictEqual(typeof createAuthSessionRuntime, 'function', 'an injectable persistent auth-session runtime must exist');
  assert.strictEqual(typeof createApiResponseCoordinator, 'function', 'API responses must pass through a request-start session coordinator');
  assert.strictEqual(typeof createNormalSessionCommitter, 'function', 'normal login must use an atomic generation-aware session commit');
  assert.strictEqual(typeof clearAuthenticatedSession, 'function', 'logout and expiry must advance generation before clearing storage');
  assert.strictEqual(typeof createSessionBoundOperation, 'function', 'direct Taro requests and downloads must share the session response boundary');

  const { runtime, state } = createSessionState();
  let releaseRefresh;
  let refreshCalls = 0;
  const coordinator = createApiResponseCoordinator({
    sessionRuntime: runtime,
    refresh: async () => {
      refreshCalls += 1;
      return new Promise(resolve => { releaseRefresh = resolve; });
    },
  });
  const requestOne = runtime.capture();
  const requestTwo = runtime.capture();
  const first401 = coordinator.handleResponse(requestOne, 401);
  await Promise.resolve();
  assert.strictEqual(refreshCalls, 1, 'the first 401 should start exactly one refresh');
  state.token = 'normal-b';
  releaseRefresh(true);
  assert.deepStrictEqual(await first401, { action: 'retry' });
  assert.deepStrictEqual(await coordinator.handleResponse(requestTwo, 401), { action: 'retry' }, 'a late second 401 from the same session must retry with current token B');
  assert.strictEqual(refreshCalls, 1, 'the late second 401 must not refresh or overwrite token B again');

  const oldNormalResponse = runtime.capture();
  state.identity = reviewIdentity;
  state.token = 'review-token';
  state.generation += 1;
  assert.deepStrictEqual(
    await coordinator.handleResponse(oldNormalResponse, 200),
    { action: 'session-changed' },
    'a delayed normal 2xx must be discarded after review session commit',
  );

  state.identity = normalIdentity;
  state.token = 'normal-a';
  state.generation += 1;
  const sameNormalResponse = runtime.capture();
  state.token = 'normal-b';
  assert.deepStrictEqual(
    await coordinator.handleResponse(sameNormalResponse, 200),
    { action: 'accept' },
    'a normal 2xx remains valid across same-session A to B token rotation',
  );

  state.identity = reviewIdentity;
  state.token = 'review-token';
  state.generation += 1;
  const reviewRequest = runtime.capture();
  assert.deepStrictEqual(await coordinator.handleResponse(reviewRequest, 401), { action: 'review-expired' });
  assert.strictEqual(refreshCalls, 1, 'review 401 must never enter normal refresh');

  state.identity = normalIdentity;
  state.token = 'normal-a';
  state.generation += 1;
  const delayedBoundary = createSessionBoundOperation(runtime);
  let releaseDirectResponse;
  let directResponseConsumed = false;
  const delayedDirectResponse = delayedBoundary.run(async requestSession => {
    assert.strictEqual(requestSession.token, 'normal-a');
    return new Promise(resolve => { releaseDirectResponse = resolve; });
  }).then(value => { directResponseConsumed = true; return value; });
  await Promise.resolve();
  state.identity = reviewIdentity;
  state.token = 'review-token';
  state.generation += 1;
  releaseDirectResponse({ statusCode: 200, data: { success: true, secret: true } });
  await assert.rejects(delayedDirectResponse, error => error?.code === 'AUTH_SESSION_CHANGED');
  assert.strictEqual(directResponseConsumed, false, 'a direct old-session response must fail before cache/file consumers run');

  state.identity = normalIdentity;
  state.token = 'normal-a';
  state.generation += 1;
  const rotatedBoundary = createSessionBoundOperation(runtime);
  state.token = 'normal-b';
  const rotatedResponse = await rotatedBoundary.run(async requestSession => requestSession.token);
  assert.strictEqual(rotatedResponse, 'normal-b', 'a direct request should use current token B and remain valid within the same session');

  let legacyGeneration;
  const legacyWrites = [];
  const legacyRuntime = createAuthSessionRuntime({
    readToken: () => '',
    readIdentity: () => null,
    readGeneration: () => legacyGeneration,
    writeGeneration: value => { legacyWrites.push(value); legacyGeneration = value; },
  });
  assert.strictEqual(legacyRuntime.readGeneration(), 0);
  assert.deepStrictEqual(legacyWrites, [0], 'an old install without generation must persist generation zero');
  assert.strictEqual(legacyRuntime.advanceGeneration(), 1);
  assert.strictEqual(legacyGeneration, 1);

  const switchState = { token: 'normal-a', identity: normalIdentity, generation: 3 };
  const switchRuntime = createAuthSessionRuntime({
    readToken: () => switchState.token,
    readIdentity: () => switchState.identity,
    readGeneration: () => switchState.generation,
    writeGeneration: value => { switchState.generation = value; },
  });
  const beforeRotation = switchRuntime.capture();
  switchState.token = 'normal-b';
  assert.strictEqual(switchRuntime.isSameSession(beforeRotation), true, 'normal refresh A to B must not advance session generation');
  assert.strictEqual(switchRuntime.advanceIfIdentityChanges({ ...normalIdentity, authorization_revision: 'rev-2' }), false, 'same identity authorization refresh must not advance generation');
  assert.strictEqual(switchState.generation, 3);
  assert.strictEqual(switchRuntime.advanceIfIdentityChanges(reviewIdentity), true, 'identity switch must advance generation');
  assert.strictEqual(switchState.generation, 4);

  const committed = new Map([['auth_token', 'old-token'], ['user_info', normalIdentity]]);
  let commitGeneration = 10;
  const commitEvents = [];
  const normalCommitter = createNormalSessionCommitter({
    readUser: () => committed.get('user_info'),
    clearBusinessCache: () => commitEvents.push('clear-business'),
    clearPermissionCache: () => commitEvents.push('clear-permission'),
    removeStorage: key => { commitEvents.push(`remove:${key}`); committed.delete(key); },
    writeUser: user => { commitEvents.push('write-user'); committed.set('user_info', user); },
    setBusinessCacheIdentity: () => commitEvents.push('set-business'),
    advanceGeneration: () => { commitGeneration += 1; commitEvents.push('advance-generation'); },
    writeToken: token => { commitEvents.push('write-token'); committed.set('auth_token', token); },
    relaunch: async () => { commitEvents.push('relaunch'); },
  });
  assert.deepStrictEqual(await normalCommitter.commit({ token: 'new-token', user: normalIdentity }), { success: true });
  assert.strictEqual(commitGeneration, 11, 'normal login must advance generation once');
  assert.strictEqual(committed.get('auth_token'), 'new-token');
  assert.ok(commitEvents.indexOf('advance-generation') < commitEvents.indexOf('write-token'), 'token must be the last durable session credential');

  const failedValues = new Map([['auth_token', 'old-token'], ['user_info', normalIdentity]]);
  let rollbackGeneration = 20;
  const failedCommitter = createNormalSessionCommitter({
    readUser: () => failedValues.get('user_info'),
    clearBusinessCache: () => {},
    clearPermissionCache: () => {},
    removeStorage: key => failedValues.delete(key),
    writeUser: user => failedValues.set('user_info', user),
    setBusinessCacheIdentity: () => {},
    advanceGeneration: () => { rollbackGeneration += 1; },
    writeToken: () => { throw new Error('storage full'); },
    relaunch: async () => {},
  });
  const failedCommit = await failedCommitter.commit({ token: 'new-token', user: normalIdentity });
  assert.strictEqual(failedCommit.success, false);
  assert.strictEqual(failedValues.has('auth_token'), false, 'failed login commit must roll back token');
  assert.strictEqual(failedValues.has('user_info'), false, 'failed login commit must roll back user');
  assert.strictEqual(rollbackGeneration, 22, 'rollback must advance generation again to invalidate a partially committed session');

  const logoutValues = new Map([['auth_token', 'new-token'], ['user_info', normalIdentity], ['user_permissions', {}]]);
  let logoutGeneration = 4;
  clearAuthenticatedSession({
    advanceGeneration: () => { logoutGeneration += 1; },
    clearBusinessCache: () => {},
    clearPermissionCache: () => {},
    removeStorage: key => logoutValues.delete(key),
  });
  assert.strictEqual(logoutGeneration, 5, 'logout must advance generation');
  assert.deepStrictEqual([...logoutValues.keys()], []);

  console.log('miniapp API session runtime checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
