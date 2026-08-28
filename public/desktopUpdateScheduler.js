'use strict';

function updateErrorMessage(error) {
  return String(error?.code || error?.message || error);
}

function scheduleDesktopUpdateCheck({
  isPackaged,
  updater,
  timeoutRunner,
  log,
  setTimer = setTimeout,
  delay = 4000,
} = {}) {
  if (!isPackaged || !updater || typeof updater.checkForUpdates !== 'function') return false;
  if (typeof timeoutRunner !== 'function' || typeof log !== 'function' || typeof setTimer !== 'function') {
    throw new Error('DESKTOP_UPDATE_SCHEDULER_DEPENDENCY_INVALID');
  }

  setTimer(() => {
    try {
      const check = updater.checkForUpdates();
      Promise.resolve(timeoutRunner(check, 30000, 'UPDATE_CHECK_TIMEOUT', 'UPDATE_CHECK_TIMEOUT'))
        .catch(error => log(`Desktop update check failed ${updateErrorMessage(error)}`));
    } catch (error) {
      log(`Desktop update check failed ${updateErrorMessage(error)}`);
    }
  }, delay);
  return true;
}

module.exports = { scheduleDesktopUpdateCheck };
