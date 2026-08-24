'use strict';

const LOGIN_FIXTURE_RENDERER_ARGUMENT = '--gewu-desktop-login-fixture=1';

function resolveDevelopmentRenderer({ isPackaged, nodeEnv, fixtureFlag } = {}) {
  if (isPackaged !== false || nodeEnv !== 'development') {
    return Object.freeze({ url: null, loginFixture: false });
  }
  const loginFixture = fixtureFlag === '1';
  return Object.freeze({
    url: loginFixture
      ? 'http://localhost:3000/?__desktopLoginFixture=1'
      : 'http://localhost:3000',
    loginFixture,
  });
}

function preloadLoginFixtureEnabled(argv) {
  return Array.isArray(argv) && argv.includes(LOGIN_FIXTURE_RENDERER_ARGUMENT);
}

module.exports = Object.freeze({
  LOGIN_FIXTURE_RENDERER_ARGUMENT,
  resolveDevelopmentRenderer,
  preloadLoginFixtureEnabled,
});
