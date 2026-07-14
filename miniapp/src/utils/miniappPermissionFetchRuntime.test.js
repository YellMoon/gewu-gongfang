const assert = require('assert');
const { createAuthorizationSession } = require('./miniappAuthorizationSession');
const {
  permissionIdentityKey,
  sanitizeCapabilitiesForIdentity,
} = require('./miniappAuthorizationRuntime');
const { createPermissionFetchBoundary } = require('./miniappPermissionFetchRuntime');

const reviewAdmin = {
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

const normalAdmin = {
  id: 'admin-1',
  role: 'admin',
  user_type: 'admin',
  review_status: 'approved',
  status: 1,
  login_enabled: 1,
};

async function runFetch(identity, remoteCapabilities) {
  let currentUser = { ...identity };
  let memoryCache = null;
  let permissionState = null;
  const persistentWrites = [];
  const authorizationSession = createAuthorizationSession({
    readCache: () => null,
    writeCache: value => persistentWrites.push(value),
    clearPermissionCache: () => {},
    clearBusinessCache: () => {},
    setBusinessCacheIdentity: () => {},
    writeUser: user => { currentUser = user; },
    fetchRemote: async () => ({ identity, capabilities: remoteCapabilities }),
    sanitizeCapabilities: sanitizeCapabilitiesForIdentity,
  });
  const boundary = createPermissionFetchBoundary({
    getCurrentUser: () => currentUser,
    getMemoryCache: () => memoryCache,
    setMemoryCache: value => { memoryCache = value; },
    setPermissionState: value => { permissionState = value; },
    refreshAuthorization: localUser => authorizationSession.refresh(localUser, { force: true }),
  });
  const result = await boundary.fetchPermissions();
  return { result, memoryCache, permissionState, persistentWrites };
}

async function main() {
  const poisonedCapabilities = [
    'review-demo:read', 'review-demo:admin', 'review-demo:student', 'review-demo:paper-export',
    'question-bank:view', 'question-bank:edit', 'users:review', 'business:all', 'business:teacher-scope',
  ];
  const review = await runFetch(reviewAdmin, poisonedCapabilities);
  const safeReviewCapabilities = [
    'review-demo:read', 'review-demo:admin', 'review-demo:paper-export', 'question-bank:view',
  ];
  assert.deepStrictEqual(review.result.capabilities, safeReviewCapabilities, 'fetchPermissions must return only the strict review allowlist');
  assert.deepStrictEqual(review.memoryCache.capabilities, safeReviewCapabilities, 'the in-memory fetch cache must be sanitized');
  assert.deepStrictEqual(review.permissionState.capabilities, safeReviewCapabilities, 'the effective permission state must be sanitized');
  const persistedReview = review.persistentWrites.filter(Boolean).at(-1);
  assert.deepStrictEqual(persistedReview.capabilities, safeReviewCapabilities, 'raw poisoned review capabilities must never reach persistent storage');
  assert.deepStrictEqual(review.result.permissions.map(item => item.id), safeReviewCapabilities);

  const adminUsersPageCapabilities = review.result.capabilities || [];
  assert.strictEqual(adminUsersPageCapabilities.includes('business:all'), false, 'admin users page must not read users for a review identity');
  assert.strictEqual(adminUsersPageCapabilities.includes('users:review'), false, 'admin users page must not enable review controls for a review identity');
  assert.strictEqual(adminUsersPageCapabilities.includes('question-bank:edit'), false);

  const normalCapabilities = ['users:review', 'business:all', 'question-bank:view', 'question-bank:edit'];
  const normal = await runFetch(normalAdmin, normalCapabilities);
  assert.deepStrictEqual(normal.result.capabilities, normalCapabilities, 'normal verified users must keep their server capabilities');
  assert.deepStrictEqual(normal.persistentWrites.filter(Boolean).at(-1).capabilities, normalCapabilities);
  assert.strictEqual(normal.result.capabilities.includes('users:review'), true, 'normal superuser-style page consumption must remain unchanged');

  const malformedReview = { ...reviewAdmin, id: 'admin-1' };
  assert.deepStrictEqual(sanitizeCapabilitiesForIdentity(malformedReview, poisonedCapabilities), [], 'malformed review markers must fail closed at the fetch boundary');
  const idOnlyMalformedReview = { ...normalAdmin, id: 'review-demo:admin:broken' };
  const malformedFetch = await runFetch(idOnlyMalformedReview, poisonedCapabilities);
  assert.deepStrictEqual(malformedFetch.result.capabilities, [], 'a review-demo id without a strict review identity must not return capabilities');
  assert.strictEqual(malformedFetch.persistentWrites.filter(Boolean).length, 0, 'a malformed review identity must never be persisted as verified');
  assert.ok(permissionIdentityKey(reviewAdmin));
  console.log('miniapp permission fetch runtime checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
