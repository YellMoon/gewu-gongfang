const assert = require('assert');
const { createAuthorizationSession, fingerprint } = require('./miniappAuthorizationSession');
const { permissionIdentityKey } = require('./miniappAuthorizationRuntime');

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
    fetchRemote: async () => ({ identity: identity(), capabilities: ['business:teacher-scope', 'question-bank:view'] }),
  });
  const refreshed = await session.refresh({ id: 'user-1', user_type: 'teacher', teacher_id: 'teacher-1' }, { force: true });
  assert.strictEqual(session.getFetchCount(), 1, 'cold start must request the server even when a fresh persistent cache exists');
  assert.strictEqual(refreshed.status, 'loaded');

  let familyWrittenUser;
  const familyIdentity = identity({
    role: 'family_member', user_type: 'family_member', teacher_id: null,
    student_id: 'student-1', linked_student_ids: ['student-1'],
    identity_kind: 'family_member', student_relationship: 'guardian',
    account_state: 'formal', token_use: 'miniapp-cloud',
  });
  const familySession = createAuthorizationSession({
    readCache: () => null,
    writeCache: () => {},
    clearPermissionCache: () => {},
    clearBusinessCache: () => {},
    setBusinessCacheIdentity: () => {},
    writeUser: user => { familyWrittenUser = user; },
    fetchRemote: async () => ({ identity: familyIdentity, capabilities: ['question-bank:view'] }),
  });
  const familyResult = await familySession.refresh(familyIdentity, { force: true });
  assert.strictEqual(familyResult.status, 'loaded', 'a formal family member must remain an active cloud identity');
  assert.deepStrictEqual(familyResult.capabilities, ['question-bank:view'], 'a formal family member must retain the server-authorized read capability');
  assert.strictEqual(familyWrittenUser.role, 'family_member');
  assert.strictEqual(familyWrittenUser.student_id, 'student-1');
  assert.deepStrictEqual(familyWrittenUser.linked_student_ids, ['student-1']);
  assert.strictEqual(familyWrittenUser.student_relationship, 'guardian');

  const visitorIdentity = identity({
    role: 'visitor', user_type: 'visitor', teacher_id: null,
    account_state: 'formal', token_use: 'miniapp-cloud',
  });
  const visitorSession = createAuthorizationSession({
    readCache: () => null,
    writeCache: () => {},
    clearPermissionCache: () => {},
    clearBusinessCache: () => {},
    setBusinessCacheIdentity: () => {},
    writeUser: () => {},
    fetchRemote: async () => ({ identity: visitorIdentity, capabilities: ['question-bank:view'] }),
  });
  const visitorResult = await visitorSession.refresh(visitorIdentity, { force: true });
  assert.deepStrictEqual(visitorResult.capabilities, [], 'visitor must not enter the formal cloud-identity allowlist');

  assert.strictEqual(
    fingerprint(identity({ tenant_id: 'tenant-a', linked_student_ids: ['student-b', 'student-a'] })),
    permissionIdentityKey(identity({ tenantId: 'tenant-a', linkedStudentIds: ['student-a', 'student-b', 'student-a'] })),
    'authorization sessions must use the same complete and alias-stable normal scope fingerprint as every other session boundary',
  );

  const poisonedScopeCases = [
    {
      label: 'tenant',
      local: identity({ tenant_id: 'tenant-a' }),
      remote: identity({ tenantId: 'tenant-b' }),
    },
    {
      label: 'student binding',
      local: identity({ role: 'student', teacher_id: null, student_id: 'student-a', linked_student_ids: ['student-b'] }),
      remote: identity({ role: 'student', teacher_id: null, studentId: 'student-a', linkedStudentIds: ['student-c'] }),
    },
    {
      label: 'account status',
      local: identity({ status: 0 }),
      remote: identity({ status: 1 }),
    },
  ];
  for (const scopeCase of poisonedScopeCases) {
    const scopeEvents = [];
    const poisonedCache = { verified: true, identity: scopeCase.remote, capabilities: ['business:teacher-scope'] };
    const scopeSession = createAuthorizationSession({
      readCache: () => poisonedCache,
      writeCache: () => {},
      clearPermissionCache: () => scopeEvents.push('clear-permission'),
      clearBusinessCache: () => scopeEvents.push('clear-business'),
      setBusinessCacheIdentity: () => scopeEvents.push('set-business'),
      writeUser: () => {},
      fetchRemote: async () => ({ identity: scopeCase.remote, capabilities: ['business:teacher-scope'] }),
    });
    await scopeSession.refresh(scopeCase.local, { force: true });
    assert.deepStrictEqual(
      scopeEvents.slice(0, 2),
      ['clear-business', 'clear-permission'],
      `a persistent cache poisoned with the remote ${scopeCase.label} scope must not hide a change from the current locally verified identity`,
    );
  }

  let canonicalWrittenUser;
  const canonicalRemote = identity({
    tenant_id: 'tenant-new', teacher_id: 'teacher-new', student_id: 'student-new',
    linked_student_ids: ['student-linked-new'], active: true, deleted: false, disabled: false,
  });
  const canonicalSession = createAuthorizationSession({
    readCache: () => null,
    writeCache: () => {},
    clearPermissionCache: () => {},
    clearBusinessCache: () => {},
    setBusinessCacheIdentity: () => {},
    writeUser: user => { canonicalWrittenUser = user; },
    fetchRemote: async () => ({ identity: canonicalRemote, capabilities: ['business:teacher-scope'] }),
  });
  await canonicalSession.refresh({
    id: 'user-1', user_type: 'teacher', tenantId: 'tenant-old', teacherId: 'teacher-old',
    studentId: 'student-old', linkedStudentIds: ['student-linked-old'], active: true, deleted: false, disabled: false,
  }, { force: true });
  assert.strictEqual(canonicalWrittenUser.tenantId, undefined, 'a verified canonical tenant must remove the stale local alias');
  assert.strictEqual(canonicalWrittenUser.teacherId, undefined, 'a verified canonical teacher binding must remove the stale local alias');
  assert.strictEqual(canonicalWrittenUser.studentId, undefined, 'a verified canonical student binding must remove the stale local alias');
  assert.strictEqual(canonicalWrittenUser.linkedStudentIds, undefined, 'revoked local student aliases must not survive a remote refresh');
  assert.strictEqual(permissionIdentityKey(canonicalWrittenUser), permissionIdentityKey(canonicalRemote), 'the persisted user must contain only the verified remote normal scope');

  for (const inactiveOverride of [{ active: false }, { deleted: true }, { disabled: true }]) {
    const inactiveEvents = [];
    const inactiveSession = createAuthorizationSession({
      readCache: () => null,
      writeCache: value => inactiveEvents.push(['write-cache', value]),
      clearPermissionCache: () => inactiveEvents.push(['clear-permission']),
      clearBusinessCache: () => inactiveEvents.push(['clear-business']),
      setBusinessCacheIdentity: () => inactiveEvents.push(['set-business']),
      writeUser: () => {},
      fetchRemote: async () => ({ identity: identity(inactiveOverride), capabilities: ['business:teacher-scope'] }),
    });
    const inactiveResult = await inactiveSession.refresh(identity(), { force: true });
    assert.deepStrictEqual(inactiveResult.capabilities, [], `${JSON.stringify(inactiveOverride)} must fail closed even before status/login flags converge`);
    assert.ok(inactiveEvents.some(event => event[0] === 'clear-business'));
    assert.ok(!inactiveEvents.some(event => event[0] === 'set-business'));
    assert.ok(inactiveEvents.some(event => event[0] === 'write-cache' && event[1] === null));
  }

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

  const rejectedEvents = [];
  const rejected = createAuthorizationSession({
    readCache: () => oldCache, writeCache: () => {}, clearPermissionCache: () => rejectedEvents.push('clear-permission'),
    clearBusinessCache: () => rejectedEvents.push('clear-business'), setBusinessCacheIdentity: () => {}, writeUser: () => {},
    onIdentityRejected: user => rejectedEvents.push(['identity-rejected', user.id]),
    fetchRemote: async () => {
      const error = new Error('Cloud identity rejected');
      error.code = 'CLOUD_MINIAPP_IDENTITY_REJECTED';
      throw error;
    },
  });
  const rejectedResult = await rejected.refresh({ id: 'user-1', user_type: 'teacher', teacher_id: 'teacher-1' }, { force: true });
  assert.strictEqual(rejectedResult.status, 'error');
  assert.deepStrictEqual(rejectedEvents, ['clear-business', 'clear-permission', ['identity-rejected', 'user-1']],
    'a server-rejected identity must clear only that stale session, while ordinary network failures stay recoverable');
  console.log('miniapp authorization session checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
