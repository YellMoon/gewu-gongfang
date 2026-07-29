'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync: defaultSpawnSync } = require('child_process');

function commandFor(platform, command) {
  return platform === 'win32' ? `${command}.cmd` : command;
}

function packageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertBuildElectronEntryFresh({ cwd = process.cwd() } = {}) {
  const publicEntry = path.join(cwd, 'public', 'electron.js');
  const buildEntry = path.join(cwd, 'build', 'electron.js');
  if (!fs.existsSync(publicEntry) || !fs.existsSync(buildEntry)) {
    throw packageError('BUILD_ELECTRON_ENTRY_REQUIRED');
  }
  if (fs.readFileSync(publicEntry, 'utf8') !== fs.readFileSync(buildEntry, 'utf8')) {
    throw packageError('BUILD_ELECTRON_ENTRY_STALE');
  }
}

function assertBuildRendererEntryFresh({ cwd = process.cwd() } = {}) {
  const rendererEntry = path.join(cwd, 'build', 'index.html');
  const assetManifest = path.join(cwd, 'build', 'asset-manifest.json');
  if (!fs.existsSync(rendererEntry) || !fs.existsSync(assetManifest)) {
    throw packageError('BUILD_RENDERER_ENTRY_REQUIRED');
  }
  const renderer = fs.readFileSync(rendererEntry, 'utf8');
  if (!renderer.includes('id="root"')) throw packageError('BUILD_RENDERER_ENTRY_INVALID');
}

function assertPackagedRendererEntry({ cwd = process.cwd(), outputDir } = {}) {
  const sourceRendererRoot = path.join(cwd, 'build');
  const sourceEntry = path.join(sourceRendererRoot, 'index.html');
  const sourceElectron = path.join(sourceRendererRoot, 'electron.js');
  const artifactRoot = path.isAbsolute(String(outputDir || ''))
    ? String(outputDir)
    : path.join(cwd, String(outputDir || ''));
  const packagedRendererRoot = path.join(artifactRoot, 'win-unpacked', 'resources', 'app', 'build');
  const packagedEntry = path.join(packagedRendererRoot, 'index.html');
  const packagedElectron = path.join(packagedRendererRoot, 'electron.js');
  if (!fs.existsSync(sourceEntry) || !fs.existsSync(packagedEntry)) {
    throw packageError('PACKAGED_RENDERER_ENTRY_REQUIRED');
  }
  if (fs.readFileSync(sourceEntry, 'utf8') !== fs.readFileSync(packagedEntry, 'utf8')) {
    throw packageError('PACKAGED_RENDERER_ENTRY_STALE');
  }
  if (!fs.existsSync(sourceElectron) || !fs.existsSync(packagedElectron)) {
    throw packageError('PACKAGED_ELECTRON_ENTRY_REQUIRED');
  }
  if (fs.readFileSync(sourceElectron, 'utf8') !== fs.readFileSync(packagedElectron, 'utf8')) {
    throw packageError('PACKAGED_ELECTRON_ENTRY_STALE');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(sourceRendererRoot, 'asset-manifest.json'), 'utf8'));
  } catch (_error) {
    throw packageError('PACKAGED_RENDERER_MANIFEST_INVALID');
  }
  const mainAsset = String(manifest?.files?.['main.js'] || '');
  if (!mainAsset) throw packageError('PACKAGED_RENDERER_MAIN_ASSET_REQUIRED');
  const relativeAsset = mainAsset.replace(/^\.\//, '');
  const sourceAsset = path.resolve(sourceRendererRoot, relativeAsset);
  const packagedAsset = path.resolve(packagedRendererRoot, relativeAsset);
  if (!sourceAsset.startsWith(`${sourceRendererRoot}${path.sep}`) || !packagedAsset.startsWith(`${packagedRendererRoot}${path.sep}`)) {
    throw packageError('PACKAGED_RENDERER_MAIN_ASSET_INVALID');
  }
  if (!fs.existsSync(sourceAsset) || !fs.existsSync(packagedAsset)) {
    throw packageError('PACKAGED_RENDERER_MAIN_ASSET_MISSING');
  }
  if (fs.readFileSync(sourceAsset, 'utf8') !== fs.readFileSync(packagedAsset, 'utf8')) {
    throw packageError('PACKAGED_RENDERER_MAIN_ASSET_STALE');
  }
}

function runHostRuntimePackage({
  spawnSync = defaultSpawnSync,
  cwd = process.cwd(),
  outputDir = process.env.GEWU_RUNTIME_PACKAGE_OUTPUT || 'tmp-runtime-contract-host',
  platform = process.platform,
  packagedRendererVerifier = assertPackagedRendererEntry,
} = {}) {
  const normalizedOutput = String(outputDir || '').trim();
  if (!normalizedOutput || path.isAbsolute(normalizedOutput) || normalizedOutput.includes('..')) {
    throw packageError('HOST_RUNTIME_PACKAGE_OUTPUT_INVALID');
  }
  const spawnOptions = { cwd, stdio: 'inherit', shell: platform === 'win32' };
  const build = spawnSync(commandFor(platform, 'npm'), ['run', 'build'], spawnOptions);
  if (build?.status !== 0) throw packageError('HOST_RUNTIME_BUILD_FAILED');
  assertBuildRendererEntryFresh({ cwd });
  assertBuildElectronEntryFresh({ cwd });
  const verify = spawnSync(commandFor(platform, 'npm'), ['run', 'verify:electron-native-abi'], spawnOptions);
  if (verify?.status !== 0) throw packageError('ELECTRON_NATIVE_ABI_GATE_FAILED');
  const builder = spawnSync(commandFor(platform, 'npx'), [
    'electron-builder',
    '--win',
    '--dir',
    '--config',
    'electron-builder.host.config.cjs',
    `--config.directories.output=${normalizedOutput}`,
  ], spawnOptions);
  if (builder?.status !== 0) throw packageError('HOST_RUNTIME_PACKAGE_FAILED');
  packagedRendererVerifier({ cwd, outputDir: normalizedOutput });
  return Object.freeze({ outputDir: normalizedOutput });
}

if (require.main === module) runHostRuntimePackage();

module.exports = {
  runHostRuntimePackage,
  packageError,
  assertBuildElectronEntryFresh,
  assertBuildRendererEntryFresh,
  assertPackagedRendererEntry,
};
