'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promotePrimaryHostRuntime } = require('./promote-primary-host-runtime');

function writeRuntime(root, marker) {
  const app = path.join(root, 'resources', 'app');
  const publicRoot = path.join(app, 'public');
  const build = path.join(app, 'build');
  fs.mkdirSync(path.join(build, 'static', 'js'), { recursive: true });
  fs.mkdirSync(publicRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'Gewu.exe'), marker);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    desktopBuildFlavor: 'primary-host',
    desktopCapabilityManifest: { flavor: 'primary-host', revision: 1 },
  }));
  fs.writeFileSync(path.join(publicRoot, 'electron.js'), "require('./primaryHostRuntimeStatus'); require('./primaryHostRelaunchReadiness');");
  fs.writeFileSync(path.join(publicRoot, 'primaryHostRuntimeStatus.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(publicRoot, 'primaryHostRelaunchReadiness.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(build, 'index.html'), '<div id="root"></div>');
  fs.writeFileSync(path.join(build, 'asset-manifest.json'), JSON.stringify({ files: { 'main.js': './static/js/main.js' } }));
  fs.writeFileSync(path.join(build, 'static', 'js', 'main.js'), marker);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-host-promote-'));
try {
  const source = path.join(root, 'source');
  const installed = path.join(root, 'installed');
  const rollback = path.join(root, 'installed.rollback');
  const staging = path.join(root, 'installed.stage');
  writeRuntime(source, 'new-runtime');
  writeRuntime(installed, 'old-runtime');

  const result = promotePrimaryHostRuntime({
    sourceRoot: source,
    installRoot: installed,
    stagingRoot: staging,
    rollbackRoot: rollback,
    executableName: 'Gewu.exe',
  });
  assert.deepStrictEqual(result, { installRoot: installed, rollbackRoot: rollback, renderer: true });
  assert.equal(fs.readFileSync(path.join(installed, 'resources', 'app', 'build', 'static', 'js', 'main.js'), 'utf8'), 'new-runtime');
  assert.equal(fs.readFileSync(path.join(rollback, 'resources', 'app', 'build', 'static', 'js', 'main.js'), 'utf8'), 'old-runtime');
  assert.equal(fs.existsSync(staging), false, 'the staging tree must be atomically renamed into place');

  const invalid = path.join(root, 'invalid');
  fs.mkdirSync(invalid);
  assert.throws(
    () => promotePrimaryHostRuntime({
      sourceRoot: invalid,
      installRoot: path.join(root, 'second-installed'),
      stagingRoot: path.join(root, 'second-stage'),
      rollbackRoot: path.join(root, 'second-rollback'),
      executableName: 'Gewu.exe',
    }),
    /INSTALLED_HOST_EXECUTABLE_MISSING/
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('primary-host runtime promotion tests passed');
