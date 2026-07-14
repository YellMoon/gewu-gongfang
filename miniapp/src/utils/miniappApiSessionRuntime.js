const { permissionIdentityKey } = require('./miniappAuthorizationRuntime');
const { hasReviewExperienceMarker } = require('./reviewExperience');

const AUTH_SESSION_GENERATION_KEY = 'auth_session_generation';
const AUTH_SESSION_STORAGE_KEYS = ['auth_token', 'user_info', 'user_permissions'];

function normalizedGeneration(value) {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

function createAuthSessionRuntime(dependencies) {
  function readGeneration() {
    let stored;
    try {
      stored = dependencies.readGeneration();
    } catch (_error) {
      return 0;
    }
    const generation = normalizedGeneration(stored);
    if (stored === '' || stored === null || stored === undefined || generation !== Number(stored)) {
      try { dependencies.writeGeneration(generation); } catch (_error) { /* fail closed at the next session mutation */ }
    }
    return generation;
  }

  function advanceGeneration() {
    const generation = readGeneration();
    if (generation >= Number.MAX_SAFE_INTEGER) throw new Error('AUTH_SESSION_GENERATION_EXHAUSTED');
    const next = generation + 1;
    dependencies.writeGeneration(next);
    return next;
  }

  function safeRead(read, fallback) {
    try { return read(); } catch (_error) { return fallback; }
  }

  function capture() {
    const identity = safeRead(dependencies.readIdentity, null) || null;
    return {
      token: String(safeRead(dependencies.readToken, '') || ''),
      generation: readGeneration(),
      identityKey: permissionIdentityKey(identity),
      review: hasReviewExperienceMarker(identity),
    };
  }

  function isSameSession(snapshot) {
    if (!snapshot) return false;
    const current = capture();
    return current.generation === snapshot.generation
      && current.identityKey === snapshot.identityKey;
  }

  function advanceIfIdentityChanges(nextIdentity) {
    const currentIdentity = safeRead(dependencies.readIdentity, null);
    if (permissionIdentityKey(currentIdentity) === permissionIdentityKey(nextIdentity)) return false;
    advanceGeneration();
    return true;
  }

  return { advanceGeneration, advanceIfIdentityChanges, capture, isSameSession, readGeneration };
}

function createApiResponseCoordinator(dependencies) {
  async function handleResponse(requestSession, statusCode) {
    if (!dependencies.sessionRuntime.isSameSession(requestSession)) {
      return { action: 'session-changed' };
    }
    if (statusCode !== 401) return { action: 'accept' };
    if (requestSession.review) return { action: 'review-expired' };

    const current = dependencies.sessionRuntime.capture();
    if (current.token && current.token !== requestSession.token) {
      return { action: 'retry' };
    }

    await dependencies.refresh();
    if (!dependencies.sessionRuntime.isSameSession(requestSession)) {
      return { action: 'session-changed' };
    }
    const afterRefresh = dependencies.sessionRuntime.capture();
    if (afterRefresh.token && afterRefresh.token !== requestSession.token) {
      return { action: 'retry' };
    }
    return { action: 'auth-expired' };
  }

  return { handleResponse };
}

function authSessionChangedError() {
  const error = new Error('AUTH_SESSION_CHANGED');
  error.code = 'AUTH_SESSION_CHANGED';
  return error;
}

function isAuthSessionChangedError(error) {
  return error?.code === 'AUTH_SESSION_CHANGED';
}

function createSessionBoundOperation(sessionRuntime) {
  const binding = sessionRuntime.capture();

  function assertCurrent() {
    if (!sessionRuntime.isSameSession(binding)) throw authSessionChangedError();
  }

  function currentSession() {
    assertCurrent();
    return sessionRuntime.capture();
  }

  async function run(operation) {
    const requestSession = currentSession();
    const result = await operation(requestSession);
    assertCurrent();
    return result;
  }

  return { assertCurrent, binding, currentSession, run };
}

function cleanupStorageKeys(dependencies, identities = []) {
  const keys = [...AUTH_SESSION_STORAGE_KEYS];
  if (typeof dependencies.cleanupStorageKeys === 'function') {
    for (const identity of identities) {
      const extraKeys = dependencies.cleanupStorageKeys(identity);
      if (Array.isArray(extraKeys)) keys.push(...extraKeys);
    }
  }
  return Array.from(new Set(keys.filter(Boolean)));
}

function clearAuthenticatedSession(dependencies, identities = []) {
  const errors = [];
  for (const action of [
    dependencies.advanceGeneration,
    dependencies.clearBusinessCache,
    dependencies.clearPermissionCache,
  ]) {
    try { if (typeof action === 'function') action(); } catch (error) { errors.push(error); }
  }
  for (const key of cleanupStorageKeys(dependencies, identities)) {
    try { dependencies.removeStorage(key); } catch (error) { errors.push(error); }
  }
  return { success: errors.length === 0, errors };
}

function validatedNormalSession(responseData) {
  const token = typeof responseData?.token === 'string' ? responseData.token.trim() : '';
  const user = responseData?.user;
  if (!token || !user || !user.id || hasReviewExperienceMarker(user)) return null;
  return { token, user };
}

function createNormalSessionCommitter(dependencies) {
  async function commit(responseData) {
    const session = validatedNormalSession(responseData);
    if (!session) return { success: false, code: 'AUTH_SESSION_RESPONSE_INVALID' };
    let identities = [null, session.user];
    try {
      identities = [dependencies.readUser() || null, session.user];
      dependencies.clearBusinessCache();
      dependencies.clearPermissionCache();
      for (const key of cleanupStorageKeys(dependencies, identities)) dependencies.removeStorage(key);
      dependencies.writeUser(session.user);
      dependencies.setBusinessCacheIdentity(session.user);
      dependencies.advanceGeneration();
      dependencies.writeToken(session.token);
      await dependencies.relaunch();
      return { success: true };
    } catch (error) {
      clearAuthenticatedSession(dependencies, identities);
      return { success: false, code: 'AUTH_SESSION_COMMIT_FAILED', error };
    }
  }

  return { commit };
}

module.exports = {
  AUTH_SESSION_GENERATION_KEY,
  AUTH_SESSION_STORAGE_KEYS,
  clearAuthenticatedSession,
  createApiResponseCoordinator,
  createAuthSessionRuntime,
  createNormalSessionCommitter,
  createSessionBoundOperation,
  isAuthSessionChangedError,
  normalizedGeneration,
};
