const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isReviewExperienceIdentity,
  reviewSessionIdentityKey,
  reviewTaskCacheKey,
  experienceApiPath,
  createReviewSessionCommitter,
  createSynchronousMutex,
  reviewCleanupStorageKeys,
  reviewLoginErrorMessage,
  reviewArtifactRequest,
} = require('./reviewExperience');
const { fingerprint, isActive } = require('./miniappAuthorizationSession');

const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const adminReview = {
  id: 'review-demo:admin:session-a',
  role: 'admin',
  user_type: 'admin',
  review_status: 'approved',
  status: 1,
  login_enabled: 1,
  is_review_demo: true,
  read_only: true,
  review_demo_session_id: 'session-a',
};
const secondAdminReview = { ...adminReview, id: 'review-demo:admin:session-b', review_demo_session_id: 'session-b' };
const normalAdmin = { id: 'admin-1', role: 'admin', user_type: 'admin' };

assert.strictEqual(isReviewExperienceIdentity(adminReview), true, 'verified review markers and a session id should identify review mode');
assert.strictEqual(isReviewExperienceIdentity({ ...adminReview, id: 'review-demo:admin:another-session' }), false, 'synthetic id must match the role and server session');
assert.strictEqual(isReviewExperienceIdentity({ ...adminReview, role: 'student' }), false, 'synthetic role fields must agree');
assert.strictEqual(isReviewExperienceIdentity({ ...adminReview, login_enabled: 0 }), false, 'disabled synthetic identities must not enter review mode');
assert.strictEqual(isReviewExperienceIdentity({ ...adminReview, read_only: false }), false, 'review mode must remain read only');
assert.strictEqual(isReviewExperienceIdentity({ ...adminReview, review_demo_session_id: '' }), false, 'review mode requires a server session identity');
assert.strictEqual(isReviewExperienceIdentity(normalAdmin), false, 'normal users must never be classified as review users');
assert.strictEqual(reviewSessionIdentityKey(adminReview), 'review-demo:admin:session-a');
assert.notStrictEqual(reviewSessionIdentityKey(adminReview), reviewSessionIdentityKey(secondAdminReview), 'each review session needs its own identity namespace');
assert.strictEqual(isActive(adminReview), true, 'a server-verified synthetic review identity should be active');
assert.notStrictEqual(fingerprint(adminReview), fingerprint(secondAdminReview), 'authorization fingerprints must include review session identity');

assert.ok(reviewTaskCacheKey(adminReview).includes('session-a'), 'review task cache must include the review session');
assert.notStrictEqual(reviewTaskCacheKey(adminReview), reviewTaskCacheKey(secondAdminReview), 'review task caches must be isolated by session');
assert.notStrictEqual(reviewTaskCacheKey(adminReview), 'question_paper_tasks_v2', 'review tasks must not use the real-user task key');

assert.strictEqual(experienceApiPath(adminReview, 'snapshot'), '/api/cloud/snapshots/read?snapshotType=full');
assert.strictEqual(experienceApiPath(adminReview, 'questionPreview'), '/api/cloud/snapshots/questions');
assert.strictEqual(experienceApiPath(adminReview, 'createTask'), '/api/review-demo/tasks');
assert.strictEqual(experienceApiPath(adminReview, 'taskResult', 'task-1'), '/api/review-demo/tasks/task-1/result');
assert.strictEqual(experienceApiPath(adminReview, 'cancelTask', 'task-1'), '/api/review-demo/tasks/task-1/cancel');
assert.strictEqual(experienceApiPath(adminReview, 'artifact', 'artifact-1'), '/api/review-demo/artifacts/artifact-1');
assert.throws(() => experienceApiPath(adminReview, 'taskResult'), /requires a resource id/);
assert.throws(() => experienceApiPath(adminReview, 'artifact', ''), /requires a resource id/);
assert.strictEqual(experienceApiPath(normalAdmin, 'createTask'), '/api/cloud/tasks');
assert.strictEqual(experienceApiPath(normalAdmin, 'taskResult', 'task-1'), '/api/cloud/tasks/task-1/result');
assert.strictEqual(experienceApiPath(normalAdmin, 'cancelTask', 'task-1'), '/api/cloud/tasks/task-1/cancel');

const malformedReviewMarkers = [
  { ...normalAdmin, is_review_demo: true },
  { ...normalAdmin, read_only: true },
  { ...normalAdmin, id: 'review-demo:admin:broken' },
  { ...normalAdmin, review_demo_session_id: 'broken-session' },
  { ...normalAdmin, capability: 'review-demo:admin' },
  { ...normalAdmin, capabilities: ['review-demo:read', 'business:all'] },
];
for (const malformedIdentity of malformedReviewMarkers) {
  for (const [operation, resourceId] of [
    ['createTask'], ['taskResult', 'task-1'], ['cancelTask', 'task-1'], ['artifact', 'artifact-1'],
  ]) {
    assert.throws(
      () => experienceApiPath(malformedIdentity, operation, resourceId),
      error => error?.code === 'REVIEW_DEMO_IDENTITY_INVALID'
        && error?.message === 'REVIEW_DEMO_IDENTITY_INVALID',
      `${operation} must fail closed for malformed review markers`,
    );
  }
}
assert.deepStrictEqual(reviewArtifactRequest(adminReview, 'review-token', 'artifact/1'), {
  path: '/api/review-demo/artifacts/artifact%2F1',
  header: { Authorization: 'Bearer review-token' },
}, 'review artifact requests must combine the isolated path with the current bearer token');
assert.throws(() => reviewArtifactRequest(adminReview, '', 'artifact-1'), /review token is required/);

assert.deepStrictEqual(reviewCleanupStorageKeys(adminReview), [
  'auth_token',
  'user_info',
  'user_permissions',
  `sch_${reviewTaskCacheKey(adminReview)}`,
], 'review cleanup must identify direct auth keys and the session task cache key');

assert.strictEqual(reviewLoginErrorMessage('REVIEW_DEMO_CODE_INVALID'), '审核体验码无效，请核对提审说明');
assert.strictEqual(reviewLoginErrorMessage('REVIEW_DEMO_DISABLED'), '审核体验暂未启用，请联系开发者');
assert.strictEqual(reviewLoginErrorMessage('REVIEW_DEMO_RATE_LIMITED'), '审核体验尝试次数过多，请稍后再试');
assert.strictEqual(reviewLoginErrorMessage('REVIEW_DEMO_TOKEN_INVALID'), '审核体验已过期，请重新进入');
assert.strictEqual(reviewLoginErrorMessage('', '网络连接失败，请检查网络'), '网络连接失败，请检查网络后重试');

const apiSource = read('miniapp/src/utils/api.ts');
const loginSource = read('miniapp/src/pages/login/index.tsx');
const authSessionPath = 'miniapp/src/utils/authSession.ts';
const authSessionSource = fs.existsSync(path.join(root, authSessionPath)) ? read(authSessionPath) : '';
const permissionSource = read('miniapp/src/utils/permission.ts');
const settingsSource = read('miniapp/src/pages/settings/index.tsx');
const homeSource = read('miniapp/src/pages/index/index.tsx');
const syncSource = read('miniapp/src/utils/sync.ts');
const syncEngineSource = read('miniapp/src/utils/syncEngine.ts');
const questionBankSource = read('miniapp/src/pages/question-bank/index.tsx');
assert.ok(apiSource.includes("'/api/auth/review-demo'"), 'review login API must use the real gateway route');
assert.ok(apiSource.includes('reviewDemoApi')
  && apiSource.includes('reviewDemoPath')
  && apiSource.includes('experienceApiPath')
  && apiSource.includes('reviewArtifactRequest'), 'sandbox API integration must reuse the behavior-tested path and bearer helpers');
assert.ok(apiSource.includes('createAuthRefreshRuntime') && apiSource.includes('this.authRefreshRuntime.refresh()'), 'API 401 handling must use the behavior-tested refresh coordinator');
assert.ok(authSessionSource.includes('AUTH_SESSION_GENERATION_KEY') && authSessionSource.includes('AUTH_SESSION_STATE_KEY')
  && authSessionSource.includes('createAuthSessionRuntime'), 'the miniapp must persist one shared injectable auth-session generation and validity state');
assert.ok(apiSource.includes('createApiResponseCoordinator')
  && apiSource.includes('responseCoordinator.handleResponse')
  && apiSource.includes('const isCurrentSession')
  && apiSource.includes('authSessionRuntime.isSameSession(session, sessionOptions)'), 'every API response and retry must remain bound to the request-start session');
assert.ok(loginSource.includes('createNormalSessionCommitter')
  && loginSource.includes('invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance()')
  && loginSource.includes('activateSession: () => authSessionRuntime.activate()'), 'normal and review login must commit through the shared persistent session runtime');
assert.ok(loginSource.includes('authSessionRuntime.capture().token')
  && !loginSource.includes("if (Taro.getStorageSync('auth_token'))"), 'login redirect must ignore a stale raw token after durable logout invalidation');
assert.ok(permissionSource.includes('authSessionRuntime.advanceIfIdentityChanges(user)'), 'authorization identity switches must advance session generation without treating token rotation as a switch');
assert.ok(settingsSource.includes('clearAuthenticatedSession') && settingsSource.includes('invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance()')
  && homeSource.includes('clearAuthenticatedSession') && homeSource.includes('invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance()')
  && apiSource.includes('invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance()'), 'all logout and expiry paths must use one monotonic invalidate-and-advance transition');
assert.ok(syncSource.includes('createSessionBoundOperation') && syncEngineSource.includes('createSessionBoundOperation'), 'direct sync responses must be discarded before mutating queues or caches after a session switch');
assert.ok(!syncEngineSource.includes('requestSession.token || token'), 'sync must never fall back to a caller-captured token after binding a newer empty session');
assert.ok(questionBankSource.includes('createSessionBoundOperation') && apiSource.includes('createSessionBoundOperation'), 'artifact access and download responses must stay bound through file consumption');
assert.ok(loginSource.includes('review-title'), 'the login page must permanently identify the review entry');
assert.ok(loginSource.includes('review-code-input'), 'the login page must expose a dedicated review code field');
assert.ok(loginSource.includes('data-review-role="admin"') && loginSource.includes('data-review-role="student"'), 'the login page must expose administrator and student review controls');
assert.ok(loginSource.includes('authApi.reviewDemo') && loginSource.includes('reviewLoginErrorMessage'), 'review login must use the dedicated backend contract and stable error mapping');
assert.ok(!loginSource.includes('MINIAPP_REVIEW_EXPERIENCE_CODE'), 'the real review code must never be embedded in the miniapp');

async function testAtomicReviewSessionCommit() {
  const values = new Map([['user_info', normalAdmin], ['auth_token', 'normal-token']]);
  const events = [];
  let generation = 4;
  const committer = createReviewSessionCommitter({
    readUser: () => values.get('user_info'),
    clearBusinessCache: () => events.push('clear-business'),
    clearPermissionCache: () => events.push('clear-permission'),
    removeStorage: key => { events.push(`remove:${key}`); values.delete(key); },
    writeUser: user => { events.push('write-user'); values.set('user_info', user); },
    setBusinessCacheIdentity: () => events.push('set-business-identity'),
    advanceGeneration: () => { generation += 1; events.push('advance-generation'); },
    writeToken: token => { events.push('write-token'); values.set('auth_token', token); },
    relaunch: async () => events.push('relaunch'),
  });
  const committed = await committer.commit({ token: ' review-token ', role: 'admin', user: adminReview }, 'admin');
  assert.deepStrictEqual(committed, { success: true });
  assert.strictEqual(values.get('user_info'), adminReview);
  assert.strictEqual(values.get('auth_token'), 'review-token');
  assert.strictEqual(generation, 5, 'review login must advance persistent session generation');
  assert.ok(events.indexOf('write-user') < events.indexOf('write-token'), 'identity must be persisted before token');
  assert.ok(events.indexOf('advance-generation') < events.indexOf('write-token'), 'generation must advance before the review credential is exposed');
  assert.ok(events.indexOf('write-token') < events.indexOf('relaunch'), 'token must be the last session write before relaunch');
}

async function testAtomicReviewSessionRollback() {
  const values = new Map([['user_info', normalAdmin], ['auth_token', 'normal-token']]);
  const removed = [];
  let generation = 8;
  const committer = createReviewSessionCommitter({
    readUser: () => values.get('user_info'),
    clearBusinessCache: () => {},
    clearPermissionCache: () => {},
    removeStorage: key => { removed.push(key); values.delete(key); },
    writeUser: user => values.set('user_info', user),
    setBusinessCacheIdentity: () => {},
    advanceGeneration: () => { generation += 1; },
    writeToken: () => { throw new Error('second session write failed'); },
    relaunch: async () => {},
  });
  const failed = await committer.commit({ token: 'review-token', role: 'admin', user: adminReview }, 'admin');
  assert.strictEqual(failed.success, false);
  assert.strictEqual(values.has('auth_token'), false, 'failed commit must not leave a token');
  assert.strictEqual(values.has('user_info'), false, 'failed commit must not leave a synthetic identity');
  assert.strictEqual(generation, 10, 'failed review commit must advance once for the attempt and again for rollback');
  assert.ok(removed.includes('user_permissions'));
  assert.ok(removed.includes(`sch_${reviewTaskCacheKey(adminReview)}`), 'failed commit must clear the attempted review task namespace');
}

async function testReviewSessionRelaunchRollback() {
  const values = new Map();
  let generation = 12;
  const committer = createReviewSessionCommitter({
    readUser: () => null,
    clearBusinessCache: () => {},
    clearPermissionCache: () => {},
    removeStorage: key => values.delete(key),
    writeUser: user => values.set('user_info', user),
    setBusinessCacheIdentity: () => {},
    advanceGeneration: () => { generation += 1; },
    writeToken: token => values.set('auth_token', token),
    relaunch: async () => { throw new Error('relaunch failed'); },
  });
  const failed = await committer.commit({ token: 'review-token', role: 'admin', user: adminReview }, 'admin');
  assert.strictEqual(failed.code, 'REVIEW_DEMO_SESSION_COMMIT_FAILED');
  assert.strictEqual(values.has('auth_token'), false, 'relaunch failure must roll back the token');
  assert.strictEqual(values.has('user_info'), false, 'relaunch failure must roll back the identity');
  assert.strictEqual(generation, 14);
}

async function testReviewSessionInitialReadRollback() {
  const removed = [];
  let generation = 2;
  const committer = createReviewSessionCommitter({
    readUser: () => { throw new Error('storage read failed'); },
    clearBusinessCache: () => {},
    clearPermissionCache: () => {},
    removeStorage: key => removed.push(key),
    writeUser: () => {},
    setBusinessCacheIdentity: () => {},
    advanceGeneration: () => { generation += 1; },
    writeToken: () => {},
    relaunch: async () => {},
  });
  const failed = await committer.commit({ token: 'review-token', role: 'admin', user: adminReview }, 'admin');
  assert.strictEqual(failed.code, 'REVIEW_DEMO_SESSION_COMMIT_FAILED');
  assert.ok(removed.includes('auth_token'), 'initial storage read failure must still enter rollback');
  assert.ok(removed.includes(`sch_${reviewTaskCacheKey(adminReview)}`));
  assert.strictEqual(generation, 4, 'the attempt must advance before the failed read and rollback must advance again');
}

async function testReviewSessionValidationAndMutex() {
  let writes = 0;
  const committer = createReviewSessionCommitter({
    readUser: () => null,
    clearBusinessCache: () => { writes += 1; }, clearPermissionCache: () => { writes += 1; },
    removeStorage: () => { writes += 1; }, writeUser: () => { writes += 1; },
    setBusinessCacheIdentity: () => { writes += 1; }, advanceGeneration: () => { writes += 1; },
    writeToken: () => { writes += 1; }, relaunch: async () => { writes += 1; },
  });
  assert.strictEqual((await committer.commit({ token: ' ', role: 'admin', user: adminReview }, 'admin')).code, 'REVIEW_DEMO_RESPONSE_INVALID');
  assert.strictEqual((await committer.commit({ token: 'token', role: 'student', user: adminReview }, 'admin')).code, 'REVIEW_DEMO_RESPONSE_INVALID');
  assert.strictEqual(writes, 0, 'invalid backend responses must not mutate local session state');
  const mutex = createSynchronousMutex();
  assert.strictEqual(mutex.tryAcquire(), true);
  assert.strictEqual(mutex.tryAcquire(), false, 'a synchronous mutex must reject a rapid second login attempt');
  mutex.release();
  assert.strictEqual(mutex.tryAcquire(), true);
}

(async () => {
  await testAtomicReviewSessionCommit();
  await testAtomicReviewSessionRollback();
  await testReviewSessionRelaunchRollback();
  await testReviewSessionInitialReadRollback();
  await testReviewSessionValidationAndMutex();
  console.log('miniapp review experience checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
