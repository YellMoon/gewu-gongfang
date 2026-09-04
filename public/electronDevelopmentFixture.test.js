'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {
  LOGIN_FIXTURE_RENDERER_ARGUMENT,
  resolveDevelopmentRenderer,
  preloadLoginFixtureEnabled,
} = require('./electronDevelopmentFixture');

assert.deepStrictEqual(resolveDevelopmentRenderer({
  isPackaged: false,
  nodeEnv: 'development',
  fixtureFlag: '1',
}), {
  url: 'http://localhost:3000/?__desktopLoginFixture=1',
  loginFixture: true,
});
assert.deepStrictEqual(resolveDevelopmentRenderer({
  isPackaged: false,
  nodeEnv: 'development',
  fixtureFlag: '',
}), {
  url: 'http://localhost:3000',
  loginFixture: false,
});
for (const input of [
  { isPackaged: true, nodeEnv: 'development', fixtureFlag: '1' },
  { isPackaged: true, nodeEnv: 'production', fixtureFlag: '1' },
  { isPackaged: false, nodeEnv: 'production', fixtureFlag: '1' },
]) assert.deepStrictEqual(resolveDevelopmentRenderer(input), { url: null, loginFixture: false });

assert.strictEqual(preloadLoginFixtureEnabled(['electron', LOGIN_FIXTURE_RENDERER_ARGUMENT]), true);
assert.strictEqual(preloadLoginFixtureEnabled(['electron', '--gewu-desktop-login-fixture=0']), false);
assert.strictEqual(preloadLoginFixtureEnabled([]), false);

const chromeFixtureSource = fs.readFileSync('src/services/desktopLoginChromeFixture.mjs', 'utf8');
assert.ok(chromeFixtureSource.includes("cloudBusinessIdentityBaseUrl: 'http://127.0.0.1:3001'"),
  'the isolated login fixture must never resolve its identity API to the production cloud endpoint');

function exposedByPreload(argv) {
  const exposed = {};
  const source = fs.readFileSync('public/preload.js', 'utf8');
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'electron') return {
        contextBridge: { exposeInMainWorld(key, value) { exposed[key] = value; } },
        ipcRenderer: { invoke() {}, on() {}, removeListener() {}, sendSync() {} },
      };
      if (name === './electronDevelopmentFixture') return { preloadLoginFixtureEnabled };
      throw new Error(`unexpected require: ${name}`);
    },
    process: { argv, env: { NODE_ENV: 'development', GEWU_E2E_DESKTOP_LOGIN_FIXTURE: '1' } },
    console,
  }, { filename: 'preload.js' });
  return Object.keys(exposed).sort();
}

assert.deepStrictEqual(exposedByPreload(['electron', LOGIN_FIXTURE_RENDERER_ARGUMENT]), [],
  'login fixture renderer must receive no real preload bridge');
assert.deepStrictEqual(exposedByPreload(['electron']), [
  'api',
  'desktopAuthority',
  'desktopBuild',
  'desktopIdentity',
  'env',
  'questionDraftProvenance',
  'questionImportRelay',
].sort(), 'normal renderer must retain the production preload bridge');

console.log('Electron development login fixture boundary checks passed');
