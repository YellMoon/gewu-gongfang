function extractRefreshToken(payload) {
  if (!payload || payload.success !== true) return '';
  return typeof payload.token === 'string' ? payload.token.trim() : '';
}

function createAuthRefreshRuntime(dependencies) {
  let inFlight = null;

  function refreshKey(session) {
    return JSON.stringify([session.generation, session.identityKey, session.token]);
  }

  function refresh() {
    const originalSession = dependencies.sessionRuntime.capture();
    if (!originalSession.token) {
      return Promise.resolve(false);
    }
    const key = refreshKey(originalSession);
    if (inFlight && inFlight.key === key) return inFlight.operation;
    const operation = (async () => {
      try {
        const replacementToken = await dependencies.requestRefresh(originalSession.token);
        if (typeof replacementToken !== 'string' || !replacementToken.trim()) return false;
        if (!dependencies.sessionRuntime.isSameSession(originalSession)) return false;
        const currentSession = dependencies.sessionRuntime.capture();
        if (currentSession.token !== originalSession.token) return false;
        dependencies.writeToken(replacementToken.trim());
        return true;
      } catch (_error) {
        return false;
      }
    })();
    const entry = { key, operation };
    inFlight = entry;
    operation.finally(() => {
      if (inFlight === entry) inFlight = null;
    });
    return operation;
  }

  return { refresh };
}

module.exports = { createAuthRefreshRuntime, extractRefreshToken };
