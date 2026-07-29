'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runHostRuntimePackage,
  assertBuildElectronEntryFresh,
  assertBuildRendererEntryFresh,
  assertPackagedRendererEntry,
} = require('./package-host-runtime-contract');

const calls = [];
let packagedRendererVerified = false;
runHostRuntimePackage({
  spawnSync: (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  },
  outputDir: 'tmp-contract-output',
  platform: 'win32',
  packagedRendererVerifier: ({ outputDir }) => {
    packagedRendererVerified = outputDir === 'tmp-contract-output';
  },
});
assert.equal(calls.length, 3);
assert.equal(calls[0].options.shell, true, 'Windows command wrappers must execute through cmd.exe');
assert.deepStrictEqual(calls[0].args, ['run', 'build'], 'a fresh renderer build must precede every host package');
assert.deepStrictEqual(calls[1].args, ['run', 'verify:electron-native-abi'], 'the Electron ABI gate must run before any package output is created');
assert.ok(calls[2].args.includes('--dir'));
assert.ok(calls[2].args.includes('--config.directories.output=tmp-contract-output'));
assert.ok(calls[2].args.includes('electron-builder.host.config.cjs'));
assert.equal(packagedRendererVerified, true, 'a successful package must be verified before it is accepted');

assert.throws(() => runHostRuntimePackage({
  spawnSync: (_command, args) => ({ status: args[1] === 'verify:electron-native-abi' ? 1 : 0 }),
  outputDir: 'tmp-contract-output',
  platform: 'win32',
  packagedRendererVerifier: () => {},
}), /ELECTRON_NATIVE_ABI_GATE_FAILED/);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-host-package-entry-'));
try {
  fs.mkdirSync(path.join(temporaryRoot, 'public'));
  fs.mkdirSync(path.join(temporaryRoot, 'build'));
  fs.writeFileSync(path.join(temporaryRoot, 'public', 'electron.js'), 'new-entry', 'utf8');
  fs.writeFileSync(path.join(temporaryRoot, 'build', 'electron.js'), 'stale-entry', 'utf8');
  assert.throws(
    () => assertBuildElectronEntryFresh({ cwd: temporaryRoot }),
    error => error && error.code === 'BUILD_ELECTRON_ENTRY_STALE'
  );
  fs.writeFileSync(path.join(temporaryRoot, 'build', 'electron.js'), 'new-entry', 'utf8');
  assert.doesNotThrow(() => assertBuildElectronEntryFresh({ cwd: temporaryRoot }));

  assert.throws(
    () => assertBuildRendererEntryFresh({ cwd: temporaryRoot }),
    error => error && error.code === 'BUILD_RENDERER_ENTRY_REQUIRED'
  );
  fs.writeFileSync(path.join(temporaryRoot, 'build', 'index.html'), '<div id="root"></div>', 'utf8');
  fs.mkdirSync(path.join(temporaryRoot, 'build', 'static', 'js'), { recursive: true });
  fs.writeFileSync(path.join(temporaryRoot, 'build', 'static', 'js', 'main.js'), 'renderer-current', 'utf8');
  fs.writeFileSync(path.join(temporaryRoot, 'build', 'asset-manifest.json'), JSON.stringify({ files: { 'main.js': './static/js/main.js' } }), 'utf8');
  assert.doesNotThrow(() => assertBuildRendererEntryFresh({ cwd: temporaryRoot }));

  const artifactRoot = path.join(temporaryRoot, 'artifact', 'win-unpacked', 'resources', 'app');
  fs.mkdirSync(path.join(artifactRoot, 'build'), { recursive: true });
  assert.throws(
    () => assertPackagedRendererEntry({ cwd: temporaryRoot, outputDir: path.join(temporaryRoot, 'artifact') }),
    error => error && error.code === 'PACKAGED_RENDERER_ENTRY_REQUIRED'
  );
  fs.writeFileSync(path.join(artifactRoot, 'build', 'index.html'), '<div id="root"></div>', 'utf8');
  assert.throws(
    () => assertPackagedRendererEntry({ cwd: temporaryRoot, outputDir: path.join(temporaryRoot, 'artifact') }),
    error => error && error.code === 'PACKAGED_ELECTRON_ENTRY_REQUIRED'
  );
  fs.writeFileSync(path.join(artifactRoot, 'build', 'electron.js'), 'new-entry', 'utf8');
  assert.throws(
    () => assertPackagedRendererEntry({ cwd: temporaryRoot, outputDir: path.join(temporaryRoot, 'artifact') }),
    error => error && error.code === 'PACKAGED_RENDERER_MAIN_ASSET_MISSING'
  );
  fs.mkdirSync(path.join(artifactRoot, 'build', 'static', 'js'), { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'build', 'static', 'js', 'main.js'), 'renderer-current', 'utf8');
  assert.doesNotThrow(() => assertPackagedRendererEntry({ cwd: temporaryRoot, outputDir: path.join(temporaryRoot, 'artifact') }));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
console.log('host runtime package gate tests passed');
