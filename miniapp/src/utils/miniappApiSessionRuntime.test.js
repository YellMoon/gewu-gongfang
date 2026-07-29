const assert = require('assert');
const fs = require('fs');
const path = require('path');

let sessionModule = {};
try {
  sessionModule = require('./miniappApiSessionRuntime');
} catch (_error) {
  // The first RED should be an assertion that names the missing behavior boundary.
}

const {
  captureTrustedAuthSession,
  clearAuthenticatedSession,
  createApiResponseCoordinator,
  createAuthenticationEntryBoundary,
  createAuthSessionRuntime,
  createNormalSessionCommitter,
  createSessionBoundOperation,
  openSessionBoundDocument,
} = sessionModule;

const normalIdentity = { id: 'admin-1', role: 'admin', user_type: 'admin' };
const reviewIdentity = {
  id: 'review-demo:admin:session-a', role: 'admin', user_type: 'admin', review_status: 'approved',
  status: 1, login_enabled: 1, is_review_demo: true, read_only: true, review_demo_session_id: 'session-a',
};
const unrecognizedIdentity = {
  id: 'unrecognized-1', role: 'student', user_type: 'student',
  account_state: 'unrecognized', token_use: 'unrecognized-student',
  capabilities: [
    'experience:read', 'profile-application:read', 'profile-application:submit',
    'sample-questions:view', 'sample-paper-export',
  ],
};
const visitorIdentity = {
  id: 'visitor-1', role: 'visitor', user_type: 'visitor',
  identity_kind: 'visitor', account_state: 'visitor', token_use: 'miniapp-visitor',
  authority_id: 'authority-1',
  capabilities: [
    'projection:read', 'role-application:read', 'role-application:submit',
    'question-preview:read',
  ],
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

function createPersistentSessionHarness(overrides = {}) {
  const storage = {
    token: 'normal-a',
    identity: normalIdentity,
    generation: 8,
    sessionState: { version: 1, generation: 8, invalidated: false },
    ...overrides,
  };
  const faults = {
    readToken: false,
    readIdentity: false,
    readGeneration: false,
    readSessionState: false,
    writeGeneration: false,
    writeGenerationAfterWrite: false,
    writeSessionState: false,
  };
  function createRuntime() {
    return createAuthSessionRuntime({
      readToken: () => {
        if (faults.readToken) throw new Error('token read failed');
        return storage.token;
      },
      readIdentity: () => {
        if (faults.readIdentity) throw new Error('identity read failed');
        return storage.identity;
      },
      readGeneration: () => {
        if (faults.readGeneration) throw new Error('generation read failed');
        return storage.generation;
      },
      writeGeneration: value => {
        if (faults.writeGeneration) throw new Error('generation write failed');
        storage.generation = value;
        if (faults.writeGenerationAfterWrite) throw new Error('generation write interrupted after persistence');
      },
      readSessionState: () => {
        if (faults.readSessionState) throw new Error('session state read failed');
        return storage.sessionState;
      },
      writeSessionState: value => {
        if (faults.writeSessionState) throw new Error('session state write failed');
        storage.sessionState = { ...value };
      },
    });
  }
  return { createRuntime, faults, storage };
}

async function main() {
  assert.strictEqual(typeof createAuthSessionRuntime, 'function', 'an injectable persistent auth-session runtime must exist');
  assert.strictEqual(typeof createApiResponseCoordinator, 'function', 'API responses must pass through a request-start session coordinator');
  assert.strictEqual(typeof createNormalSessionCommitter, 'function', 'normal login must use an atomic generation-aware session commit');
  assert.strictEqual(typeof clearAuthenticatedSession, 'function', 'logout and expiry must advance generation before clearing storage');
  assert.strictEqual(typeof createSessionBoundOperation, 'function', 'direct Taro requests and downloads must share the session response boundary');
  assert.strictEqual(typeof createAuthenticationEntryBoundary, 'function', 'raw platform login and the public login request must bind to their starting session generation and identity');
  assert.strictEqual(typeof openSessionBoundDocument, 'function', 'question-bank document consumption must use the same session boundary as access and download');
  assert.strictEqual(typeof captureTrustedAuthSession, 'function', 'startup consumers need one trusted token/identity capture gate');

  const trustedStartupHarness = createPersistentSessionHarness();
  const trustedStartup = captureTrustedAuthSession(trustedStartupHarness.createRuntime());
  assert.strictEqual(trustedStartup.token, 'normal-a');
  assert.deepStrictEqual(trustedStartup.identity, normalIdentity);
  const staleStartupHarness = createPersistentSessionHarness({
    token: 'stale-token',
    identity: normalIdentity,
    sessionState: { version: 1, generation: 8, invalidated: true },
  });
  assert.strictEqual(
    captureTrustedAuthSession(staleStartupHarness.createRuntime()),
    null,
    'startup must reject an invalidated session even when raw token and user storage still exist',
  );

  const monotonicRuntime = createPersistentSessionHarness({ generation: 2, sessionState: { version: 1, generation: 2, invalidated: false } });
  const monotonicSession = monotonicRuntime.createRuntime();
  assert.strictEqual(typeof monotonicSession.invalidateAndAdvance, 'function', 'session invalidation and generation advance must be one monotonic transition');
  assert.strictEqual(monotonicSession.invalidateAndAdvance(), 3);
  assert.strictEqual(monotonicRuntime.storage.generation, 3);
  assert.deepStrictEqual(monotonicRuntime.storage.sessionState, { version: 1, generation: 3, invalidated: true });

  const delayedLoginState = createSessionState({ token: '', identity: null, generation: 2 });
  const delayedLoginBoundary = createAuthenticationEntryBoundary(delayedLoginState.runtime);
  let releasePlatformLogin;
  let wechatRequests = 0;
  let loginCommits = 0;
  const delayedLogin = (async () => {
    await delayedLoginBoundary.run(() => new Promise(resolve => { releasePlatformLogin = resolve; }));
    await delayedLoginBoundary.run(async () => { wechatRequests += 1; return { success: true }; });
    delayedLoginBoundary.assertCurrent();
    loginCommits += 1;
  })();
  await Promise.resolve();
  delayedLoginState.state.identity = normalIdentity;
  delayedLoginState.state.token = 'normal-switched';
  delayedLoginState.state.generation += 1;
  releasePlatformLogin({ code: 'stale-code' });
  await assert.rejects(delayedLogin, error => error?.code === 'AUTH_SESSION_CHANGED');
  assert.strictEqual(wechatRequests, 0, 'a switch during delayed platform login must abort before the WeChat login request');
  assert.strictEqual(loginCommits, 0, 'a switch during delayed platform login must never commit the old login');

  const delayedRequestState = createSessionState({ token: '', identity: null, generation: 4 });
  const delayedRequestBoundary = createAuthenticationEntryBoundary(delayedRequestState.runtime);
  let releaseWechatRequest;
  let markWechatRequestStarted;
  const wechatRequestStarted = new Promise(resolve => { markWechatRequestStarted = resolve; });
  const delayedRequest = (async () => {
    await delayedRequestBoundary.run(async () => ({ code: 'fresh-code' }));
    await delayedRequestBoundary.run(() => new Promise(resolve => {
      releaseWechatRequest = resolve;
      markWechatRequestStarted();
    }));
    delayedRequestBoundary.assertCurrent();
    loginCommits += 1;
  })();
  await wechatRequestStarted;
  delayedRequestState.state.identity = normalIdentity;
  delayedRequestState.state.token = 'another-session';
  delayedRequestState.state.generation += 1;
  releaseWechatRequest({ success: true, data: { token: 'stale-token', user: normalIdentity } });
  await assert.rejects(delayedRequest, error => error?.code === 'AUTH_SESSION_CHANGED');
  assert.strictEqual(loginCommits, 0, 'a switch while the WeChat request is pending must reject the response before session commit');

  const publicLoginHarness = createPersistentSessionHarness({
    token: 'removed-too-late',
    identity: normalIdentity,
    generation: 13,
    sessionState: { version: 1, generation: 13, invalidated: true },
  });
  const publicLoginBoundary = createAuthenticationEntryBoundary(publicLoginHarness.createRuntime());
  assert.deepStrictEqual(
    await publicLoginBoundary.run(async () => ({ code: 'fresh-code' })),
    { code: 'fresh-code' },
    'a provable invalidated signed-out session must still be allowed to start a public login',
  );

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
  const lateRequestCoordinator = createApiResponseCoordinator({
    sessionRuntime: runtime,
    refresh: async () => { refreshCalls += 1; return true; },
  });
  assert.deepStrictEqual(await lateRequestCoordinator.handleResponse(requestTwo, 401), { action: 'retry' }, 'a late second logical request from the same session must retry with current token B');
  assert.strictEqual(refreshCalls, 1, 'the late second 401 must not refresh or overwrite token B again');

  const singleRequest = createSessionState({ token: 'normal-a' });
  let singleRefreshCalls = 0;
  let singleNetworkRequests = 0;
  const singleRequestCoordinator = createApiResponseCoordinator({
    sessionRuntime: singleRequest.runtime,
    refresh: async () => {
      singleRefreshCalls += 1;
      singleRequest.state.token = singleRefreshCalls === 1 ? 'normal-b' : 'normal-c';
      return true;
    },
  });
  let finalDecision;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    singleNetworkRequests += 1;
    finalDecision = await singleRequestCoordinator.handleResponse(singleRequest.runtime.capture(), 401);
    if (finalDecision.action !== 'retry') break;
  }
  assert.deepStrictEqual(finalDecision, { action: 'auth-expired' }, 'B 401 must end the same logical request with a stable auth failure');
  assert.strictEqual(singleRefreshCalls, 1, 'one logical request must never refresh B into C');
  assert.strictEqual(singleNetworkRequests, 2, 'one logical request may send only A and one auth retry with B');
  assert.strictEqual(singleRequest.state.token, 'normal-b', 'the rejected B session must not be overwritten by a second refresh');

  const experienceState = createSessionState({ token: 'experience-a', identity: unrecognizedIdentity });
  const experienceRequest = experienceState.runtime.capture();
  assert.strictEqual(experienceRequest.experienceOnly, true, 'real unrecognized identities must be marked as experience-only sessions');
  let experienceRefreshCalls = 0;
  const experienceCoordinator = createApiResponseCoordinator({
    sessionRuntime: experienceState.runtime,
    refresh: async () => {
      experienceRefreshCalls += 1;
      experienceState.state.token = 'experience-b';
    },
  });
  assert.deepStrictEqual(await experienceCoordinator.handleResponse(experienceRequest, 401), { action: 'retry' });
  assert.strictEqual(experienceRefreshCalls, 1, 'unrecognized sessions must refresh through the shared Backend session flow');

  const visitorState = createSessionState({ token: 'visitor-a', identity: visitorIdentity });
  const visitorRequest = visitorState.runtime.capture();
  assert.strictEqual(visitorRequest.experienceOnly, true, 'signed visitors must stay on the limited projection-only session path');
  assert.strictEqual(visitorRequest.identityKey.includes('visitor:'), true);

  const identityCases = [
    {
      label: 'tenant switch',
      before: { id: 'admin-1', role: 'admin', tenant_id: 'tenant-a', review_status: 'approved', status: 1, login_enabled: 1 },
      after: { id: 'admin-1', role: 'admin', tenantId: 'tenant-b', review_status: 'approved', status: 1, login_enabled: 1 },
    },
    {
      label: 'teacher binding switch',
      before: { id: 'teacher-user', role: 'teacher', tenant_id: 'tenant-a', teacher_id: 'teacher-a', review_status: 'approved', status: 1, login_enabled: 1 },
      after: { id: 'teacher-user', role: 'teacher', tenantId: 'tenant-a', teacherId: 'teacher-b', review_status: 'approved', status: 1, login_enabled: 1 },
    },
    {
      label: 'student binding switch',
      before: { id: 'student-user', role: 'student', student_id: 'student-a', linked_student_ids: ['student-b', 'student-a'], review_status: 'approved', status: 1, login_enabled: 1 },
      after: { id: 'student-user', role: 'student', studentId: 'student-a', linkedStudentIds: ['student-c', 'student-a'], review_status: 'approved', status: 1, login_enabled: 1 },
    },
    {
      label: 'review status downgrade',
      before: { id: 'admin-1', role: 'admin', review_status: 'approved', status: 1, login_enabled: 1 },
      after: { id: 'admin-1', role: 'admin', review_status: 'pending', status: 1, login_enabled: 1 },
    },
    {
      label: 'account status downgrade',
      before: { id: 'admin-1', role: 'admin', review_status: 'approved', status: 1, login_enabled: 1 },
      after: { id: 'admin-1', role: 'admin', review_status: 'approved', status: 0, login_enabled: 1 },
    },
    {
      label: 'active flag downgrade',
      before: { id: 'admin-1', role: 'admin', review_status: 'approved', status: 1, active: true, login_enabled: 1 },
      after: { id: 'admin-1', role: 'admin', review_status: 'approved', status: 1, active: false, login_enabled: 1 },
    },
    {
      label: 'login disabled',
      before: { id: 'admin-1', role: 'admin', review_status: 'approved', status: 1, login_enabled: 1 },
      after: { id: 'admin-1', role: 'admin', review_status: 'approved', status: 1, login_enabled: 0 },
    },
  ];
  for (const identityCase of identityCases) {
    const identityState = createSessionState({ identity: identityCase.before });
    const identityCoordinator = createApiResponseCoordinator({ sessionRuntime: identityState.runtime, refresh: async () => false });
    const oldResponse = identityState.runtime.capture();
    identityState.state.identity = identityCase.after;
    assert.deepStrictEqual(
      await identityCoordinator.handleResponse(oldResponse, 200),
      { action: 'session-changed' },
      `${identityCase.label} must reject an old normal 2xx`,
    );
  }

  const stableStudent = createSessionState({
    identity: { id: 'student-user', role: 'student', tenant_id: 'tenant-a', student_id: 'student-a', linked_student_ids: ['student-b', 'student-a'], review_status: 'approved', status: 1, login_enabled: 1 },
  });
  const stableStudentResponse = stableStudent.runtime.capture();
  stableStudent.state.identity = { id: 'student-user', user_type: 'student', tenantId: 'tenant-a', studentId: 'student-a', linkedStudentIds: ['student-a', 'student-b', 'student-a'], review_status: 'approved', status: true, login_enabled: true };
  assert.strictEqual(stableStudent.runtime.isSameSession(stableStudentResponse), true, 'identity aliases, boolean flags, and student binding order must normalize stably');

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
  assert.deepStrictEqual(await coordinator.handleResponse(reviewRequest, 401), { action: 'auth-expired' });
  assert.strictEqual(refreshCalls, 1, 'removed review sessions must not receive a dedicated refresh path');

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

  state.token = 'normal-a';
  state.identity = normalIdentity;
  state.generation += 1;
  const documentBoundary = createSessionBoundOperation(runtime);
  const temporaryFiles = [];
  let openCalls = 0;
  state.identity = reviewIdentity;
  state.token = 'review-token';
  state.generation += 1;
  await assert.rejects(
    openSessionBoundDocument(documentBoundary, {
      filePath: 'temp-old.docx',
      openDocument: async () => { openCalls += 1; },
      removeTemporaryFile: async filePath => { temporaryFiles.push(filePath); },
    }),
    error => error?.code === 'AUTH_SESSION_CHANGED',
  );
  assert.strictEqual(openCalls, 0, 'a file downloaded by an old session must not be opened after a switch');
  assert.deepStrictEqual(temporaryFiles, ['temp-old.docx'], 'a rejected old-session temporary file should be cleaned up');

  state.identity = normalIdentity;
  state.token = 'normal-a';
  state.generation += 1;
  const delayedOpenBoundary = createSessionBoundOperation(runtime);
  let releaseOpen;
  const delayedOpen = openSessionBoundDocument(delayedOpenBoundary, {
    filePath: 'temp-delayed.docx',
    openDocument: () => { openCalls += 1; return new Promise(resolve => { releaseOpen = resolve; }); },
    removeTemporaryFile: async filePath => { temporaryFiles.push(filePath); },
  });
  await Promise.resolve();
  state.identity = reviewIdentity;
  state.token = 'review-token';
  state.generation += 1;
  releaseOpen({});
  await assert.rejects(delayedOpen, error => error?.code === 'AUTH_SESSION_CHANGED');
  assert.deepStrictEqual(temporaryFiles, ['temp-old.docx', 'temp-delayed.docx'], 'a switch while openDocument is pending must reject consumption and clean up the temporary file');

  state.identity = normalIdentity;
  state.token = 'normal-a';
  state.generation += 1;
  const stableOpenBoundary = createSessionBoundOperation(runtime);
  const stableOpen = await openSessionBoundDocument(stableOpenBoundary, {
    filePath: 'temp-current.docx',
    openDocument: async options => ({ opened: options.filePath }),
    removeTemporaryFile: async filePath => { temporaryFiles.push(filePath); },
  });
  assert.deepStrictEqual(stableOpen, { opened: 'temp-current.docx' });
  assert.deepStrictEqual(temporaryFiles, ['temp-old.docx', 'temp-delayed.docx'], 'a successfully consumed current-session document must not be deleted by the failure cleanup path');

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

  const unreadable = createPersistentSessionHarness();
  const unreadableRuntime = unreadable.createRuntime();
  assert.strictEqual(unreadableRuntime.readGeneration(), 8);
  unreadable.faults.readGeneration = true;
  const unreadableCapture = unreadableRuntime.capture();
  assert.strictEqual(unreadableCapture.trusted, false, 'a generation read failure must make the capture untrusted');
  assert.strictEqual(unreadableCapture.token, '', 'an untrusted capture must never carry the old token');
  assert.strictEqual(unreadableRuntime.readGeneration(), 8, 'a read failure must retain the process-monotonic generation instead of resetting to zero');
  let unreadableNetworkCalls = 0;
  await assert.rejects(
    createSessionBoundOperation(unreadableRuntime).run(async () => {
      unreadableNetworkCalls += 1;
      return { statusCode: 200 };
    }),
    error => error?.code === 'AUTH_SESSION_CHANGED',
  );
  assert.strictEqual(unreadableNetworkCalls, 0, 'an unprovable session must be rejected before network I/O');

  let flappingGenerationReads = 0;
  const flappingRuntime = createAuthSessionRuntime({
    readToken: () => 'normal-a',
    readIdentity: () => normalIdentity,
    readGeneration: () => {
      flappingGenerationReads += 1;
      if (flappingGenerationReads >= 3) throw new Error('generation became unreadable');
      return 8;
    },
    writeGeneration: () => {},
  });
  let flappingNetworkCalls = 0;
  await assert.rejects(
    createSessionBoundOperation(flappingRuntime).run(async () => {
      flappingNetworkCalls += 1;
      return { statusCode: 200 };
    }),
    error => error?.code === 'AUTH_SESSION_CHANGED',
  );
  assert.strictEqual(flappingNetworkCalls, 0, 'the exact snapshot passed to a direct request must be proven before network I/O');

  for (const readFault of ['readToken', 'readIdentity']) {
    const unreadableCredential = createPersistentSessionHarness();
    unreadableCredential.faults[readFault] = true;
    const credentialCapture = unreadableCredential.createRuntime().capture();
    assert.strictEqual(credentialCapture.trusted, false, `${readFault} must make the session unprovable`);
    assert.strictEqual(credentialCapture.token, '', `${readFault} must never leak token A`);
  }

  unreadable.faults.writeGeneration = true;
  assert.throws(() => unreadableRuntime.advanceGeneration(), /generation write failed/);
  assert.strictEqual(unreadableRuntime.readGeneration(), 9, 'a failed durable advance must still move the in-process generation forward');

  const orphanToken = createPersistentSessionHarness({ identity: null, token: 'orphan-token' });
  const orphanCapture = orphanToken.createRuntime().capture();
  assert.strictEqual(orphanCapture.identityKey, '');
  assert.strictEqual(orphanCapture.token, '', 'an empty identity key must force an empty token and Authorization header input');

  const failedLogout = createPersistentSessionHarness({ generation: 12, sessionState: { version: 1, generation: 12, invalidated: false } });
  const failedLogoutRuntime = failedLogout.createRuntime();
  const beforeFailedLogout = failedLogoutRuntime.capture();
  const failedLogoutResult = clearAuthenticatedSession({
    invalidateSession: () => failedLogoutRuntime.invalidate(),
    advanceGeneration: () => failedLogoutRuntime.advanceGeneration(),
    clearBusinessCache: () => {},
    clearPermissionCache: () => {},
    removeStorage: () => { throw new Error('remove failed'); },
  });
  assert.strictEqual(failedLogoutResult.success, false);
  assert.strictEqual(failedLogoutRuntime.isSameSession(beforeFailedLogout), false, 'logout must invalidate old responses before fallible cleanup');
  assert.strictEqual(failedLogoutRuntime.capture().token, '', 'failed token/user removal must not expose the old session in-process');
  assert.strictEqual(failedLogout.storage.sessionState.invalidated, true, 'logout invalidation must be durable before cleanup');
  const restartedAfterFailedLogout = failedLogout.createRuntime();
  const restartedInvalidatedCapture = restartedAfterFailedLogout.capture();
  assert.strictEqual(restartedInvalidatedCapture.trusted, true, 'durable invalidation is a provable signed-out state, not a storage read failure');
  assert.strictEqual(restartedInvalidatedCapture.invalidated, true, 'a restarted process must honor durable logout invalidation');
  assert.strictEqual(restartedInvalidatedCapture.token, '', 'a restarted process must not resurrect token A after failed removal');
  assert.strictEqual(restartedAfterFailedLogout.isSameSession(restartedInvalidatedCapture), false, 'protected requests must reject an invalidated binding');
  assert.strictEqual(
    restartedAfterFailedLogout.isSameSession(restartedInvalidatedCapture, { allowInvalidated: true }),
    true,
    'an explicit authentication entry request may use the provable signed-out binding without Authorization',
  );
  let signedOutRefreshCalls = 0;
  const signedOutLoginCoordinator = createApiResponseCoordinator({
    sessionRuntime: restartedAfterFailedLogout,
    allowInvalidatedSession: true,
    authenticationEntry: true,
    refresh: async () => { signedOutRefreshCalls += 1; return false; },
  });
  assert.deepStrictEqual(
    await signedOutLoginCoordinator.handleResponse(restartedInvalidatedCapture, 401),
    { action: 'accept' },
    'authentication entry failures must be returned normally instead of refreshing or clearing again',
  );
  assert.strictEqual(signedOutRefreshCalls, 0);

  const splitLogout = createPersistentSessionHarness({
    generation: 5,
    sessionState: { version: 1, generation: 5, invalidated: false },
  });
  const splitLogoutRuntime = splitLogout.createRuntime();
  splitLogoutRuntime.capture();
  splitLogout.faults.writeSessionState = true;
  const splitLogoutResult = clearAuthenticatedSession({
    invalidateAndAdvance: () => splitLogoutRuntime.invalidateAndAdvance(),
    clearBusinessCache: () => {},
    clearPermissionCache: () => {},
    removeStorage: () => { throw new Error('remove failed'); },
  });
  assert.strictEqual(splitLogoutResult.success, false);
  assert.strictEqual(splitLogout.storage.generation, 6, 'generation should expose the partial durable advance');
  assert.deepStrictEqual(
    splitLogout.storage.sessionState,
    { version: 1, generation: 5, invalidated: false },
    'the injected session-state failure should leave the old durable state behind',
  );
  splitLogout.faults.writeSessionState = false;
  const splitRestartedCapture = splitLogout.createRuntime().capture();
  assert.strictEqual(splitRestartedCapture.generation, 6, 'restart reconciliation must keep the maximum durable generation');
  assert.strictEqual(splitRestartedCapture.invalidated, true, 'a durable generation/state mismatch must fail closed after restart');
  assert.strictEqual(splitRestartedCapture.token, '', 'restart must not resurrect token A when logout cleanup also failed');
  assert.deepStrictEqual(
    splitLogout.storage.sessionState,
    { version: 1, generation: 6, invalidated: true },
    'trusted reconciliation must durably converge the split state to invalidated',
  );

  const stateAhead = createPersistentSessionHarness({
    generation: 5,
    sessionState: { version: 1, generation: 6, invalidated: false },
  });
  stateAhead.faults.writeGenerationAfterWrite = true;
  assert.strictEqual(stateAhead.createRuntime().capture().trusted, false, 'an interrupted mismatch repair must remain untrusted in-process');
  stateAhead.faults.writeGenerationAfterWrite = false;
  const stateAheadRestart = stateAhead.createRuntime().capture();
  assert.strictEqual(stateAheadRestart.generation, 6);
  assert.strictEqual(stateAheadRestart.invalidated, true, 'state-ahead reconciliation must persist invalidation before making generations equal');
  assert.strictEqual(stateAheadRestart.token, '', 'an interrupted state-ahead repair must not make token A trusted after restart');

  const unreadableAfterRestart = createPersistentSessionHarness();
  unreadableAfterRestart.faults.readSessionState = true;
  const restartedUnreadableRuntime = unreadableAfterRestart.createRuntime();
  assert.strictEqual(restartedUnreadableRuntime.capture().trusted, false, 'a restarted process must fail closed when durable session state is unreadable');
  let restartedNetworkCalls = 0;
  await assert.rejects(
    createSessionBoundOperation(restartedUnreadableRuntime).run(async () => { restartedNetworkCalls += 1; }),
    error => error?.code === 'AUTH_SESSION_CHANGED',
  );
  assert.strictEqual(restartedNetworkCalls, 0);

  const oldInstall = createPersistentSessionHarness({ token: '', identity: null, generation: undefined, sessionState: undefined });
  const oldInstallCapture = oldInstall.createRuntime().capture();
  assert.strictEqual(oldInstallCapture.trusted, true, 'an old signed-out install must initialize a provable generation-zero state');
  assert.strictEqual(oldInstall.storage.generation, 0);
  assert.deepStrictEqual(oldInstall.storage.sessionState, { version: 1, generation: 0, invalidated: false });
  assert.strictEqual(oldInstall.createRuntime().capture().trusted, true, 'the initialized legacy state must survive a simulated restart');

  const failedIdentitySwitch = createPersistentSessionHarness();
  const failedIdentitySwitchRuntime = failedIdentitySwitch.createRuntime();
  failedIdentitySwitchRuntime.capture();
  failedIdentitySwitch.faults.writeSessionState = true;
  assert.throws(
    () => failedIdentitySwitchRuntime.advanceIfIdentityChanges({ ...normalIdentity, role: 'teacher', teacher_id: 'teacher-b' }),
    /session state write failed/,
  );
  assert.strictEqual(failedIdentitySwitchRuntime.readGeneration(), 9, 'identity switch must advance in-process even when durable invalidation write fails');
  assert.strictEqual(failedIdentitySwitchRuntime.capture().token, '', 'a partially failed identity switch must remain fail closed');

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
    invalidateSession: () => commitEvents.push('invalidate-session'),
    clearBusinessCache: () => commitEvents.push('clear-business'),
    clearPermissionCache: () => commitEvents.push('clear-permission'),
    removeStorage: key => { commitEvents.push(`remove:${key}`); committed.delete(key); },
    writeUser: user => { commitEvents.push('write-user'); committed.set('user_info', user); },
    setBusinessCacheIdentity: () => commitEvents.push('set-business'),
    advanceGeneration: () => { commitGeneration += 1; commitEvents.push('advance-generation'); },
    writeToken: token => { commitEvents.push('write-token'); committed.set('auth_token', token); },
    activateSession: () => commitEvents.push('activate-session'),
    relaunch: async () => { commitEvents.push('relaunch'); },
  });
  assert.deepStrictEqual(await normalCommitter.commit({ token: 'new-token', user: normalIdentity }), { success: true });
  assert.strictEqual(commitGeneration, 11, 'normal login must advance generation once');
  assert.strictEqual(committed.get('auth_token'), 'new-token');
  assert.ok(commitEvents.indexOf('invalidate-session') < commitEvents.indexOf('advance-generation'), 'session switch must invalidate before advancing generation');
  assert.ok(commitEvents.indexOf('advance-generation') < commitEvents.findIndex(event => event.startsWith('remove:')), 'session switch must advance before fallible storage cleanup');
  assert.ok(commitEvents.indexOf('advance-generation') < commitEvents.indexOf('write-token'), 'token must be the last durable session credential');
  assert.ok(commitEvents.indexOf('write-token') < commitEvents.indexOf('activate-session'), 'a switched session becomes trusted only after its token is durable');

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

  const appSource = fs.readFileSync(path.join(__dirname, '../app.tsx'), 'utf8');
  const homeSource = fs.readFileSync(path.join(__dirname, '../pages/index/index.tsx'), 'utf8');
  for (const [sourceName, source] of [['app startup', appSource], ['home startup', homeSource]]) {
    assert.ok(
      !source.includes("getStorageSync('auth_token')"),
      `${sourceName} must not trust raw auth_token storage`,
    );
    assert.ok(
      source.includes('captureTrustedAuthSession(authSessionRuntime)'),
      `${sourceName} must gate startup on one trusted session capture`,
    );
  }
  assert.ok(
    appSource.includes("Taro.reLaunch({ url: '/pages/login/index' })"),
    'an invalidated app launch must route to login instead of starting old-user initialization',
  );

  console.log('miniapp API session runtime checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
