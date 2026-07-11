const assert = require('assert');
const { createAuthorizationSession } = require('./miniappAuthorizationSession');

function identity(overrides = {}) {
  return { id: 'user-1', role: 'teacher', teacher_id: 'teacher-1', review_status: 'approved', status: 1, login_enabled: 1, authorization_revision: 'rev-1', ...overrides };
}

(async () => {
  const events = [];
  const oldCache = { verified: true, fetchedAt: Date.now(), identity: identity(), capabilities: ['business:teacher-scope'] };
  const session = createAuthorizationSession({
    readCache: () => oldCache,
    writeCache: value => events.push(['write', value]),
    clearPermissionCache: () => events.push(['clear-permission']),
    clearBusinessCache: () => events.push(['clear-business']),
    setBusinessCacheIdentity: user => events.push(['set-business', user.teacher_id]),
    writeUser: user => events.push(['write-user', user.teacher_id, user.user_type]),
    fetchRemote: async () => ({ identity: identity(), capabilities: ['business:teacher-scope', 'question-bank:view', 'question-bank:edit'] }),
  });
  const refreshed = await session.refresh({ id: 'user-1', user_type: 'teacher', teacher_id: 'teacher-1' }, { force: true });
  assert.strictEqual(session.getFetchCount(), 1, 'cold start must request the server even when a fresh persistent cache exists');
  assert.strictEqual(refreshed.status, 'loaded');

  const downgradedEvents = [];
  const downgraded = createAuthorizationSession({
    readCache: () => oldCache,
    writeCache: value => downgradedEvents.push(['write', value]),
    clearPermissionCache: () => downgradedEvents.push(['clear-permission']),
    clearBusinessCache: () => downgradedEvents.push(['clear-business']),
    setBusinessCacheIdentity: () => downgradedEvents.push(['set-business']),
    writeUser: user => downgradedEvents.push(['write-user', user.user_type]),
    fetchRemote: async () => ({ identity: identity({ role: 'pending', teacher_id: null, review_status: 'pending', login_enabled: 0, authorization_revision: 'rev-2' }), capabilities: [] }),
  });
  const denied = await downgraded.refresh({ id: 'user-1', user_type: 'teacher', teacher_id: 'teacher-1' }, { force: true });
  assert.deepStrictEqual(denied.capabilities, []);
  assert.ok(downgradedEvents.some(event => event[0] === 'clear-business'), 'server downgrade must clear business data');
  assert.ok(!downgradedEvents.some(event => event[0] === 'set-business'), 'pending identity must not recreate business cache');

  const capabilityDowngradeEvents = [];
  const capabilityDowngrade = createAuthorizationSession({
    readCache: () => oldCache, writeCache: () => {}, clearPermissionCache: () => capabilityDowngradeEvents.push('clear-permission'),
    clearBusinessCache: () => capabilityDowngradeEvents.push('clear-business'), setBusinessCacheIdentity: () => {}, writeUser: () => {},
    fetchRemote: async () => ({ identity: identity(), capabilities: [] }),
  });
  await capabilityDowngrade.refresh({ id: 'user-1', user_type: 'teacher', teacher_id: 'teacher-1' }, { force: true });
  assert.deepStrictEqual(capabilityDowngradeEvents, ['clear-business', 'clear-permission'], 'capability downgrade with unchanged identity must clear cached business data');

  const rotationEvents = [];
  const rotated = createAuthorizationSession({
    readCache: () => oldCache,
    writeCache: () => {}, clearPermissionCache: () => rotationEvents.push('clear-permission'),
    clearBusinessCache: () => rotationEvents.push('clear-business'),
    setBusinessCacheIdentity: user => rotationEvents.push(`set:${user.teacher_id}`),
    writeUser: user => rotationEvents.push(`user:${user.teacher_id}`),
    fetchRemote: async () => ({ identity: identity({ teacher_id: 'teacher-2', authorization_revision: 'rev-2' }), capabilities: ['business:teacher-scope'] }),
  });
  await rotated.refresh({ id: 'user-1', user_type: 'teacher', teacher_id: 'teacher-1' }, { force: true });
  assert.deepStrictEqual(rotationEvents, ['clear-business', 'clear-permission', 'user:teacher-2', 'set:teacher-2']);

  const failed = createAuthorizationSession({
    readCache: () => oldCache, writeCache: () => {}, clearPermissionCache: () => {},
    clearBusinessCache: () => {}, setBusinessCacheIdentity: () => {}, writeUser: () => {},
    fetchRemote: async () => { throw new Error('offline'); },
  });
  const failure = await failed.refresh({ id: 'user-1', user_type: 'teacher', teacher_id: 'teacher-1' }, { force: true });
  assert.strictEqual(failure.status, 'error');
  assert.deepStrictEqual(failure.capabilities, [], 'fetch failure must not reuse persisted capabilities');
  console.log('miniapp authorization session checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
