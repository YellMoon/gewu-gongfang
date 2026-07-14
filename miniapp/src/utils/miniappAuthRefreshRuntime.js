const { hasReviewExperienceMarker } = require('./reviewExperience');

function extractRefreshToken(payload) {
  if (!payload || payload.success !== true) return '';
  return typeof payload.token === 'string' ? payload.token.trim() : '';
}

function createAuthRefreshRuntime(dependencies) {
  let inFlight = null;

  function isCurrentSession(requestToken, reviewExpected) {
    const currentToken = dependencies.readToken();
    const currentIsReview = hasReviewExperienceMarker(dependencies.readIdentity());
    return String(currentToken || '') === String(requestToken || '')
      && currentIsReview === Boolean(reviewExpected);
  }

  function refresh() {
    if (inFlight) return inFlight;
    const originalToken = dependencies.readToken();
    if (!originalToken || !isCurrentSession(originalToken, false)) {
      return Promise.resolve(false);
    }
    const operation = (async () => {
      try {
        const replacementToken = await dependencies.requestRefresh(originalToken);
        if (typeof replacementToken !== 'string' || !replacementToken.trim()) return false;
        if (!isCurrentSession(originalToken, false)) return false;
        dependencies.writeToken(replacementToken.trim());
        return true;
      } catch (_error) {
        return false;
      }
    })();
    inFlight = operation;
    operation.finally(() => {
      if (inFlight === operation) inFlight = null;
    });
    return operation;
  }

  return { isCurrentSession, refresh };
}

module.exports = { createAuthRefreshRuntime, extractRefreshToken };
