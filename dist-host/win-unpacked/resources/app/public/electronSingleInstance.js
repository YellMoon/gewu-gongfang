'use strict';

function acquireDesktopSingleInstance({ app, getWindow } = {}) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function'
    || typeof app.quit !== 'function' || typeof app.on !== 'function'
    || typeof getWindow !== 'function') {
    throw new Error('ELECTRON_SINGLE_INSTANCE_CONFIG_REQUIRED');
  }
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    const window = getWindow();
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) return;
    if (typeof window.isMinimized === 'function' && window.isMinimized()
      && typeof window.restore === 'function') {
      window.restore();
    }
    if (typeof window.show === 'function') window.show();
    if (typeof window.focus === 'function') window.focus();
  });
  return true;
}

module.exports = { acquireDesktopSingleInstance };
