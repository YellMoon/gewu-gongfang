'use strict';

const assert = require('assert');
const { createAuthorizationSession } = require('./miniappAuthorizationSession');
const { permissionIdentityKey, sanitizeCapabilitiesForIdentity } = require('./miniappAuthorizationRuntime');
const { createPermissionFetchBoundary } = require('./miniappPermissionFetchRuntime');

const unrecognized = {
  id: 'unrecognized-1', role: 'student', user_type: 'student', account_state: 'unrecognized',
  token_use: 'unrecognized-student', capabilities: [
    'experience:read', 'profile-application:read', 'profile-application:submit',
    'sample-questions:view', 'sample-paper-export',
  ],
};
const visitor = {
  id: 'visitor-1', role: 'visitor', user_type: 'visitor', identity_kind: 'visitor',
  account_state: 'visitor', token_use: 'miniapp-visitor', authority_id: 'authority-test',
  capabilities: [
    'projection:read', 'role-application:read', 'role-application:submit',
    'question-preview:read',
  ],
};
const normalAdmin = {
  id: 'admin-1', role: 'admin', user_type: 'admin', review_status: 'approved',
  status: 1, login_enabled: 1,
};

async function runFetch(identity, remoteCapabilities) {
  let currentUser = { ...identity };
  let memoryCache = null;
  let permissionState = null;
  let remoteCalls = 0;
  const persistentWrites = [];
  const authorizationSession = createAuthorizationSession({
    readCache: () => null,
    writeCache: value => persistentWrites.push(value),
    clearPermissionCache: () => {},
    clearBusinessCache: () => {},
    setBusinessCacheIdentity: () => {},
    writeUser: user => { currentUser = user; },
    fetchRemote: async () => { remoteCalls += 1; return { identity, capabilities: remoteCapabilities }; },
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
  return { result, memoryCache, permissionState, persistentWrites, remoteCalls };
}

async function main() {
  const experience = await runFetch(unrecognized, ['business:all', 'users:review']);
  assert.deepStrictEqual(experience.result.capabilities, unrecognized.capabilities);
  assert.deepStrictEqual(experience.memoryCache.capabilities, unrecognized.capabilities);
  assert.deepStrictEqual(experience.permissionState, {
    status: 'loaded', identityKey: permissionIdentityKey(unrecognized), capabilities: unrecognized.capabilities,
  });
  assert.strictEqual(experience.remoteCalls, 0, 'unrecognized identity must not call the forbidden formal permission endpoint');
  assert.deepStrictEqual(experience.persistentWrites, [], 'experience capabilities come from the signed identity and need no persistent formal cache');

  const visitorAccess = await runFetch(visitor, ['business:all', 'users:review']);
  assert.deepStrictEqual(visitorAccess.result.capabilities, visitor.capabilities);
  assert.deepStrictEqual(visitorAccess.memoryCache.capabilities, visitor.capabilities);
  assert.strictEqual(visitorAccess.remoteCalls, 0, 'visitor identity must not call the legacy formal permission endpoint');
  assert.deepStrictEqual(visitorAccess.persistentWrites, [], 'visitor capabilities come from the signed visitor session');

  const normalCapabilities = ['users:review', 'business:all', 'question-bank:view', 'question-bank:edit'];
  const normal = await runFetch(normalAdmin, normalCapabilities);
  assert.deepStrictEqual(normal.result.capabilities, normalCapabilities);
  assert.strictEqual(normal.remoteCalls, 1);
  assert.deepStrictEqual(normal.persistentWrites.filter(Boolean).at(-1).capabilities, normalCapabilities);

  const legacyReview = { ...normalAdmin, id: 'review-demo:admin:legacy', is_review_demo: true };
  assert.deepStrictEqual(sanitizeCapabilitiesForIdentity(legacyReview, normalCapabilities), []);
  assert.strictEqual(permissionIdentityKey(legacyReview), '');
  console.log('miniapp permission fetch runtime checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
