'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  UNRECOGNIZED_CAPABILITIES,
  accountCapabilities,
  accountExperienceArtifactRequest,
  accountExperiencePath,
  accountSessionCleanupStorageKeys,
  hasLegacyReviewMarker,
  isUnrecognizedIdentity,
} = require('./accountExperience');

const identity = {
  id: 'account-1',
  role: 'student',
  account_state: 'unrecognized',
  token_use: 'unrecognized-student',
  capabilities: [...UNRECOGNIZED_CAPABILITIES],
};

assert.strictEqual(isUnrecognizedIdentity(identity), true);
assert.deepStrictEqual(accountCapabilities(identity), [...UNRECOGNIZED_CAPABILITIES]);

for (const invalid of [
  null,
  { ...identity, account_state: 'formal' },
  { ...identity, token_use: 'miniapp-session' },
  { ...identity, token_use: undefined, read_only: true, id: 'review-demo:student:legacy' },
  { ...identity, capabilities: identity.capabilities.slice(1) },
  { ...identity, capabilities: [...identity.capabilities, 'business:all'] },
]) {
  assert.strictEqual(isUnrecognizedIdentity(invalid), false);
  assert.deepStrictEqual(accountCapabilities(invalid), []);
}

assert.strictEqual(hasLegacyReviewMarker({ id: 'review-demo:student:legacy' }), true);
assert.strictEqual(hasLegacyReviewMarker({ token_use: 'review-demo' }), true);
assert.strictEqual(hasLegacyReviewMarker({ capabilities: ['review-demo:read'] }), true);
assert.strictEqual(hasLegacyReviewMarker(identity), false);

assert.strictEqual(accountExperiencePath(identity, 'questions'), '/api/experience/questions');
assert.strictEqual(accountExperiencePath(identity, 'createTask'), '/api/experience/tasks');
assert.strictEqual(accountExperiencePath(identity, 'taskResult', 'task-1'), '/api/experience/tasks/task-1/result');
assert.strictEqual(accountExperiencePath(identity, 'cancelTask', 'task-1'), '/api/experience/tasks/task-1/cancel');
assert.strictEqual(accountExperiencePath(identity, 'artifact', 'artifact-1'), '/api/experience/artifacts/artifact-1');
assert.strictEqual(accountExperiencePath(identity, 'applicationMine'), '/api/miniapp/applications/me');
assert.strictEqual(accountExperiencePath(identity, 'applicationSubmit'), '/api/miniapp/applications');
assert.strictEqual(accountExperiencePath(identity, 'applicationWithdraw', 'application-1'), '/api/miniapp/applications/application-1/withdraw');
assert.throws(() => accountExperiencePath(identity, 'taskResult'), /resource id/);
assert.throws(() => accountExperiencePath({ ...identity, token_use: 'miniapp-session' }, 'questions'), /unrecognized identity/);

assert.deepStrictEqual(accountExperienceArtifactRequest(identity, 'token-1', 'artifact-1'), {
  path: '/api/experience/artifacts/artifact-1',
  header: { Authorization: 'Bearer token-1' },
});
assert.throws(() => accountExperienceArtifactRequest(identity, '', 'artifact-1'), /token/);

const cleanupKeys = accountSessionCleanupStorageKeys();
for (const key of [
  'auth_token', 'user_info', 'user_permissions', 'unrecognized_session',
  'review_demo_session', 'review_demo_role', 'review_demo_code',
]) {
  assert.ok(cleanupKeys.includes(key), `session cleanup must remove ${key}`);
}

const apiSource = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
assert.ok(apiSource.includes('export const applicationApi'), 'API client should expose account application operations');
assert.ok(apiSource.includes('export const experienceApi'), 'API client should expose restricted experience operations');
assert.ok(apiSource.includes("'/api/miniapp/applications/me'") && apiSource.includes("'/api/experience/questions'"));
assert.ok(apiSource.includes("'x-idempotency-key': idempotencyKey"), 'application submissions must carry the backend-required idempotency key');
assert.ok(apiSource.includes('postWithHeaders'), 'the API client must support an idempotent application request header');
assert.ok(!apiSource.includes('DEFAULT_REVIEW_BASE_URL'), 'API client must not keep a Gateway base URL');
assert.ok(!apiSource.includes('reviewDemoApi'), 'API client must not expose the removed review-demo API');
assert.ok(!apiSource.includes('/api/auth/review-demo'), 'API client must not call the removed review login');

const appSource = fs.readFileSync('miniapp/src/app.tsx', 'utf8');
assert.ok(appSource.includes("import('./utils/accountExperience')"), 'app startup should use the real account experience identity');
assert.ok(appSource.includes('isUnrecognizedIdentity(startupSession.identity)'), 'experience-only startup must be handled before business initialization');
assert.ok(!appSource.includes("import('./utils/reviewExperience')"), 'app startup must not retain legacy review identity semantics');

console.log('miniapp account experience checks passed');
