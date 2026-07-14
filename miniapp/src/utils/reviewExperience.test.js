const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isReviewExperienceIdentity,
  reviewSessionIdentityKey,
  reviewTaskCacheKey,
  experienceApiPath,
  reviewCleanupStorageKeys,
  reviewLoginErrorMessage,
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
assert.strictEqual(experienceApiPath(normalAdmin, 'createTask'), '/api/cloud/tasks');
assert.strictEqual(experienceApiPath(normalAdmin, 'taskResult', 'task-1'), '/api/cloud/tasks/task-1/result');
assert.strictEqual(experienceApiPath(normalAdmin, 'cancelTask', 'task-1'), '/api/cloud/tasks/task-1/cancel');

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
assert.ok(apiSource.includes("'/api/auth/review-demo'"), 'review login API must use the real gateway route');
assert.ok(apiSource.includes("'/api/review-demo/tasks'"), 'review task API must use the sandbox create route');
assert.ok(apiSource.includes('reviewDemoApi')
  && apiSource.includes('/api/review-demo/tasks/${encodeURIComponent(taskId)}/result')
  && apiSource.includes('/api/review-demo/tasks/${encodeURIComponent(taskId)}/cancel')
  && apiSource.includes('/api/review-demo/artifacts/${encodeURIComponent(artifactId)}'), 'sandbox create/get/cancel/artifact methods must use the real backend paths');
const unauthorizedBranch = apiSource.indexOf('res.statusCode === 401');
const reviewExpiryBranch = apiSource.indexOf('isReviewExperienceIdentity(currentUser)', unauthorizedBranch);
const normalRefreshBranch = apiSource.indexOf('this.refreshToken()', unauthorizedBranch);
assert.ok(unauthorizedBranch >= 0 && reviewExpiryBranch > unauthorizedBranch && normalRefreshBranch > reviewExpiryBranch, 'review tokens must expire before the normal refresh branch');
assert.ok(loginSource.includes('review-title'), 'the login page must permanently identify the review entry');
assert.ok(loginSource.includes('review-code-input'), 'the login page must expose a dedicated review code field');
assert.ok(loginSource.includes('data-review-role="admin"') && loginSource.includes('data-review-role="student"'), 'the login page must expose administrator and student review controls');
assert.ok(loginSource.includes('authApi.reviewDemo') && loginSource.includes('reviewLoginErrorMessage'), 'review login must use the dedicated backend contract and stable error mapping');
assert.ok(!loginSource.includes('MINIAPP_REVIEW_EXPERIENCE_CODE'), 'the real review code must never be embedded in the miniapp');

console.log('miniapp review experience checks passed');
