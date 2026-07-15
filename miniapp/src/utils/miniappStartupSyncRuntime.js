'use strict';

function createSessionBoundNetworkSyncListener(dependencies) {
  let active = true;
  let registered = false;

  const dispose = () => {
    if (!active) return;
    active = false;
    if (registered && typeof dependencies.offNetworkStatusChange === 'function') {
      dependencies.offNetworkStatusChange(handleNetworkStatusChange);
    }
    registered = false;
  };

  async function handleNetworkStatusChange(result) {
    if (!active) return;
    if (!result?.isConnected) {
      if (typeof dependencies.onDisconnected === 'function') dependencies.onDisconnected();
      return;
    }

    if (!dependencies.isSameSession(dependencies.startupSession)) {
      dispose();
      return;
    }

    const session = dependencies.captureTrustedAuthSession();
    if (!session
      || !dependencies.isSameSession(dependencies.startupSession)
      || !dependencies.isSameSession(session)
      || dependencies.isReviewExperienceIdentity(session.identity)) {
      dispose();
      if (!session && typeof dependencies.onMissingSession === 'function') dependencies.onMissingSession();
      return;
    }

    if (typeof dependencies.onConnected === 'function') dependencies.onConnected();
    try {
      const response = await dependencies.pull(session.token);
      if (active && typeof dependencies.onPullSuccess === 'function') dependencies.onPullSuccess(response);
    } catch (error) {
      if (active && typeof dependencies.onPullFailure === 'function') dependencies.onPullFailure(error);
    }
  }

  dependencies.onNetworkStatusChange(handleNetworkStatusChange);
  registered = true;
  return dispose;
}

module.exports = { createSessionBoundNetworkSyncListener };
