const { businessCacheIdentityKey, permissionIdentityKey } = require('./miniappAuthorizationRuntime');
const { isVisitorIdentity } = require('./accountExperience');

const AUTH_SESSION_GENERATION_KEY = 'auth_session_generation';
const AUTH_SESSION_STATE_KEY = 'auth_session_state_v1';
const AUTH_SESSION_STORAGE_KEYS = ['auth_token', 'user_info', 'user_permissions'];

function normalizedGeneration(value) {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

function createAuthSessionRuntime(dependencies) {
  let memoryGeneration = 0;
  let initialized = false;
  let invalidated = false;
  let storageTrusted = false;

  function persistentState() {
    return { version: 1, generation: memoryGeneration, invalidated };
  }

  function normalizedPersistentState(value) {
    if (!value || typeof value !== 'object' || value.version !== 1) return null;
    const generation = Number(value.generation);
    if (!Number.isSafeInteger(generation) || generation < 0 || typeof value.invalidated !== 'boolean') return null;
    return { version: 1, generation, invalidated: value.invalidated };
  }

  function writePersistentState() {
    if (typeof dependencies.writeSessionState !== 'function') return;
    dependencies.writeSessionState(persistentState());
  }

  function readStorageState() {
    let storedGeneration;
    try {
      storedGeneration = dependencies.readGeneration();
    } catch (_error) {
      storageTrusted = false;
      return { generation: memoryGeneration, trusted: false };
    }

    const missingGeneration = storedGeneration === '' || storedGeneration === null || storedGeneration === undefined;
    const parsedGeneration = Number(storedGeneration);
    if (!missingGeneration && (!Number.isSafeInteger(parsedGeneration) || parsedGeneration < 0)) {
      storageTrusted = false;
      return { generation: memoryGeneration, trusted: false };
    }

    if (!initialized) {
      memoryGeneration = missingGeneration ? 0 : parsedGeneration;
      initialized = true;
    } else if (!missingGeneration && parsedGeneration > memoryGeneration) {
      memoryGeneration = parsedGeneration;
    }

    if (typeof dependencies.readSessionState !== 'function') {
      try {
        if (missingGeneration || parsedGeneration < memoryGeneration) dependencies.writeGeneration(memoryGeneration);
      } catch (_error) {
        storageTrusted = false;
        return { generation: memoryGeneration, trusted: false };
      }
      storageTrusted = true;
      return { generation: memoryGeneration, trusted: true };
    }

    let storedState;
    try {
      storedState = dependencies.readSessionState();
    } catch (_error) {
      storageTrusted = false;
      return { generation: memoryGeneration, trusted: false };
    }

    const missingState = storedState === '' || storedState === null || storedState === undefined;
    const parsedState = missingState ? null : normalizedPersistentState(storedState);
    if (!missingState && !parsedState) {
      storageTrusted = false;
      return { generation: memoryGeneration, trusted: false };
    }

    const persistedGenerationMismatch = Boolean(
      parsedState && !missingGeneration && parsedState.generation !== parsedGeneration,
    );
    if (parsedState) {
      memoryGeneration = Math.max(memoryGeneration, parsedState.generation);
      invalidated = invalidated || parsedState.invalidated;
    }
    if (persistedGenerationMismatch) invalidated = true;

    const stateNeedsWrite = !parsedState
      || parsedState.generation !== memoryGeneration
      || parsedState.invalidated !== invalidated;
    const generationNeedsWrite = missingGeneration || parsedGeneration !== memoryGeneration;
    try {
      if (stateNeedsWrite) writePersistentState();
      if (generationNeedsWrite) dependencies.writeGeneration(memoryGeneration);
    } catch (_error) {
      storageTrusted = false;
      return { generation: memoryGeneration, trusted: false };
    }

    storageTrusted = true;
    return { generation: memoryGeneration, trusted: true };
  }

  function readGeneration() {
    return readStorageState().generation;
  }

  function advanceGeneration() {
    const before = readStorageState();
    if (memoryGeneration >= Number.MAX_SAFE_INTEGER) throw new Error('AUTH_SESSION_GENERATION_EXHAUSTED');
    memoryGeneration += 1;
    initialized = true;
    const errors = [];
    try { dependencies.writeGeneration(memoryGeneration); } catch (error) { errors.push(error); }
    try { writePersistentState(); } catch (error) { errors.push(error); }
    storageTrusted = before.trusted && errors.length === 0;
    if (errors.length > 0) throw errors[0];
    return memoryGeneration;
  }

  function invalidate() {
    const before = readStorageState();
    invalidated = true;
    try {
      writePersistentState();
      storageTrusted = before.trusted;
      return memoryGeneration;
    } catch (error) {
      storageTrusted = false;
      throw error;
    }
  }

  function invalidateAndAdvance() {
    const before = readStorageState();
    if (memoryGeneration >= Number.MAX_SAFE_INTEGER) throw new Error('AUTH_SESSION_GENERATION_EXHAUSTED');
    invalidated = true;
    memoryGeneration += 1;
    initialized = true;
    const errors = [];
    try { writePersistentState(); } catch (error) { errors.push(error); }
    try { dependencies.writeGeneration(memoryGeneration); } catch (error) { errors.push(error); }
    storageTrusted = before.trusted && errors.length === 0;
    if (errors.length > 0) throw errors[0];
    return memoryGeneration;
  }

  function readValue(read) {
    try { return { ok: true, value: read() }; } catch (_error) { return { ok: false, value: null }; }
  }

  function capture() {
    const generationState = readStorageState();
    const identityRead = readValue(dependencies.readIdentity);
    const tokenRead = readValue(dependencies.readToken);
    const identity = identityRead.value || null;
    const candidateIdentityKey = permissionIdentityKey(identity);
    const trusted = generationState.trusted && storageTrusted && identityRead.ok && tokenRead.ok;
    const authenticatedStateUsable = trusted && !invalidated;
    return {
      token: authenticatedStateUsable && candidateIdentityKey ? String(tokenRead.value || '') : '',
      generation: generationState.generation,
      identity: authenticatedStateUsable && candidateIdentityKey ? identity : null,
      identityKey: authenticatedStateUsable ? candidateIdentityKey : '',
      experienceOnly: authenticatedStateUsable
        && isVisitorIdentity(identity),
      trusted,
      invalidated: trusted ? invalidated : true,
    };
  }

  function isSameSession(snapshot, options = {}) {
    if (!snapshot || snapshot.trusted !== true) return false;
    if (snapshot.invalidated && options.allowInvalidated !== true) return false;
    const current = capture();
    return current.trusted === true
      && (options.allowInvalidated === true || current.invalidated !== true)
      && current.invalidated === snapshot.invalidated
      && current.generation === snapshot.generation
      && current.identityKey === snapshot.identityKey;
  }

  function advanceIfIdentityChanges(nextIdentity) {
    const currentRead = readValue(dependencies.readIdentity);
    if (!currentRead.ok) {
      invalidateAndAdvance();
      throw new Error('AUTH_SESSION_STORAGE_UNAVAILABLE');
    }
    const currentIdentity = currentRead.value;
    if (permissionIdentityKey(currentIdentity) === permissionIdentityKey(nextIdentity)) return false;
    invalidateAndAdvance();
    return true;
  }

  function activate() {
    const state = readStorageState();
    const identityRead = readValue(dependencies.readIdentity);
    const tokenRead = readValue(dependencies.readToken);
    if (!state.trusted || !identityRead.ok || !tokenRead.ok
      || !permissionIdentityKey(identityRead.value) || !String(tokenRead.value || '')) {
      storageTrusted = false;
      throw new Error('AUTH_SESSION_STORAGE_UNAVAILABLE');
    }
    invalidated = false;
    try {
      writePersistentState();
      storageTrusted = true;
      return true;
    } catch (error) {
      invalidated = true;
      storageTrusted = false;
      throw error;
    }
  }

  return { activate, advanceGeneration, advanceIfIdentityChanges, capture, invalidate, invalidateAndAdvance, isSameSession, readGeneration };
}

function captureTrustedAuthSession(sessionRuntime) {
  const session = sessionRuntime.capture();
  if (session?.trusted !== true || session.invalidated === true
    || !session.token || !session.identityKey || !session.identity) return null;
  return session;
}

function createApiResponseCoordinator(dependencies) {
  let authRetryUsed = false;

  async function handleResponse(requestSession, statusCode) {
    const sessionOptions = dependencies.allowInvalidatedSession ? { allowInvalidated: true } : undefined;
    if (!dependencies.sessionRuntime.isSameSession(requestSession, sessionOptions)) {
      return { action: 'session-changed' };
    }
    if (dependencies.authenticationEntry) return { action: 'accept' };
    if (statusCode !== 401) return { action: 'accept' };
    if (authRetryUsed) return { action: 'auth-expired' };
    if (!requestSession?.token || !requestSession?.identity || !requestSession?.identityKey) {
      return { action: 'auth-expired' };
    }

    const current = dependencies.sessionRuntime.capture();
    if (current.token && current.token !== requestSession.token) {
      authRetryUsed = true;
      return { action: 'retry' };
    }

    await dependencies.refresh();
    if (!dependencies.sessionRuntime.isSameSession(requestSession, sessionOptions)) {
      return { action: 'session-changed' };
    }
    const afterRefresh = dependencies.sessionRuntime.capture();
    if (afterRefresh.token && afterRefresh.token !== requestSession.token) {
      authRetryUsed = true;
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

  function matchesBinding(current) {
    return binding?.trusted === true
      && binding.invalidated !== true
      && current?.trusted === true
      && current.invalidated !== true
      && current.generation === binding.generation
      && current.identityKey === binding.identityKey;
  }

  function assertCurrent() {
    if (!matchesBinding(sessionRuntime.capture())) throw authSessionChangedError();
  }

  function currentSession() {
    assertCurrent();
    const current = sessionRuntime.capture();
    if (!matchesBinding(current)) throw authSessionChangedError();
    return current;
  }

  async function run(operation) {
    const requestSession = currentSession();
    const result = await operation(requestSession);
    assertCurrent();
    return result;
  }

  return { assertCurrent, binding, currentSession, run };
}

function createAuthenticationEntryBoundary(sessionRuntime) {
  const binding = sessionRuntime.capture();

  function assertCurrent() {
    if (!sessionRuntime.isSameSession(binding, { allowInvalidated: true })) throw authSessionChangedError();
  }

  async function run(operation) {
    assertCurrent();
    const result = await operation();
    assertCurrent();
    return result;
  }

  return { assertCurrent, binding, run };
}

async function openSessionBoundDocument(sessionBoundary, dependencies) {
  try {
    return await sessionBoundary.run(() => dependencies.openDocument({
      filePath: dependencies.filePath,
      showMenu: dependencies.showMenu !== false,
    }));
  } catch (error) {
    try {
      if (typeof dependencies.removeTemporaryFile === 'function') {
        await dependencies.removeTemporaryFile(dependencies.filePath);
      }
    } catch (_cleanupError) { /* preserve the session/open failure */ }
    throw error;
  }
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
  const sessionTransitions = typeof dependencies.invalidateAndAdvance === 'function'
    ? [dependencies.invalidateAndAdvance]
    : [dependencies.invalidateSession, dependencies.advanceGeneration];
  for (const action of [
    ...sessionTransitions,
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
  const unsupportedAccountState = user?.account_state && !['formal', 'visitor'].includes(user.account_state);
  const unsupportedTokenUse = user?.token_use && !['miniapp-cloud', 'miniapp-visitor'].includes(user.token_use);
  const malformedVisitor = user?.account_state === 'visitor' && !isVisitorIdentity(user);
  if (!token || !user || !user.id || unsupportedAccountState || unsupportedTokenUse || malformedVisitor) {
    return null;
  }
  return { token, user };
}

function createNormalSessionCommitter(dependencies) {
  function invalidateAndAdvanceSession() {
    if (typeof dependencies.invalidateAndAdvance === 'function') {
      dependencies.invalidateAndAdvance();
      return;
    }
    if (typeof dependencies.invalidateSession === 'function') dependencies.invalidateSession();
    dependencies.advanceGeneration();
  }

  async function commit(responseData) {
    const session = validatedNormalSession(responseData);
    if (!session) return { success: false, code: 'AUTH_SESSION_RESPONSE_INVALID' };
    let identities = [null, session.user];
    try {
      invalidateAndAdvanceSession();
      identities = [dependencies.readUser() || null, session.user];
      dependencies.clearBusinessCache();
      dependencies.clearPermissionCache();
      for (const key of cleanupStorageKeys(dependencies, identities)) dependencies.removeStorage(key);
      dependencies.writeUser(session.user);
      if (businessCacheIdentityKey(session.user)) {
        dependencies.setBusinessCacheIdentity(session.user);
      }
      dependencies.writeToken(session.token);
      if (typeof dependencies.activateSession === 'function') dependencies.activateSession();
      await dependencies.relaunch(session.user);
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
  AUTH_SESSION_STATE_KEY,
  AUTH_SESSION_STORAGE_KEYS,
  captureTrustedAuthSession,
  clearAuthenticatedSession,
  createApiResponseCoordinator,
  createAuthenticationEntryBoundary,
  createAuthSessionRuntime,
  createNormalSessionCommitter,
  createSessionBoundOperation,
  isAuthSessionChangedError,
  normalizedGeneration,
  openSessionBoundDocument,
};
