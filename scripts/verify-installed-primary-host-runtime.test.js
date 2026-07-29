'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyInstalledPrimaryHostRuntime } = require('./verify-installed-primary-host-runtime');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-installed-host-runtime-'));
const appRoot = path.join(root, 'resources', 'app');
const publicRoot = path.join(appRoot, 'public');
fs.mkdirSync(publicRoot, { recursive: true });
fs.writeFileSync(path.join(root, 'Gewu.exe'), 'exe');
fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
  desktopBuildFlavor: 'primary-host',
  desktopCapabilityManifest: { flavor: 'primary-host', revision: 1 },
}));
fs.writeFileSync(path.join(publicRoot, 'electron.js'), "require('./primaryHostRuntimeStatus'); require('./primaryHostRelaunchReadiness');");
fs.writeFileSync(path.join(publicRoot, 'primaryHostRuntimeStatus.js'), 'module.exports = {};');
fs.writeFileSync(path.join(publicRoot, 'primaryHostRelaunchReadiness.js'), 'module.exports = {};');

assert.throws(
  () => verifyInstalledPrimaryHostRuntime({ installRoot: root, executableName: 'Gewu.exe' }),
  /INSTALLED_HOST_RENDERER_INDEX_MISSING/
);

const rendererRoot = path.join(appRoot, 'build');
fs.mkdirSync(path.join(rendererRoot, 'static', 'js'), { recursive: true });
fs.writeFileSync(path.join(rendererRoot, 'index.html'), '<div id="root"></div><script src="./static/js/main.js"></script>');
fs.writeFileSync(path.join(rendererRoot, 'asset-manifest.json'), JSON.stringify({ files: { 'main.js': './static/js/main.js' } }));
fs.writeFileSync(path.join(rendererRoot, 'static', 'js', 'main.js'), 'window.__gewu_renderer = true;');

assert.deepStrictEqual(verifyInstalledPrimaryHostRuntime({ installRoot: root, executableName: 'Gewu.exe' }), {
  installRoot: root,
  flavor: 'primary-host',
  renderer: true,
  runtimeStatus: true,
  relaunchReadiness: true,
});

fs.rmSync(path.join(publicRoot, 'primaryHostRelaunchReadiness.js'));
assert.throws(
  () => verifyInstalledPrimaryHostRuntime({ installRoot: root, executableName: 'Gewu.exe' }),
  /INSTALLED_HOST_RELAUNCH_READINESS_MODULE_MISSING/
);

fs.rmSync(root, { recursive: true, force: true });
console.log('installed primary-host runtime verification tests passed');
