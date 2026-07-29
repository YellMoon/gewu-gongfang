'use strict';

const fs = require('fs');
const path = require('path');

function installedHostError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireFile(filePath, code) {
  if (!fs.existsSync(filePath)) throw installedHostError(code);
}

function verifyInstalledRenderer(appRoot) {
  const rendererRoot = path.join(appRoot, 'build');
  const indexPath = path.join(rendererRoot, 'index.html');
  const manifestPath = path.join(rendererRoot, 'asset-manifest.json');
  requireFile(indexPath, 'INSTALLED_HOST_RENDERER_INDEX_MISSING');
  requireFile(manifestPath, 'INSTALLED_HOST_RENDERER_MANIFEST_MISSING');

  const index = fs.readFileSync(indexPath, 'utf8');
  if (!/id=["']root["']/.test(index)) throw installedHostError('INSTALLED_HOST_RENDERER_ROOT_MISSING');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_error) {
    throw installedHostError('INSTALLED_HOST_RENDERER_MANIFEST_INVALID');
  }
  const mainAsset = String(manifest?.files?.['main.js'] || '');
  if (!mainAsset) throw installedHostError('INSTALLED_HOST_RENDERER_MAIN_ASSET_MISSING');
  const mainAssetPath = path.resolve(rendererRoot, mainAsset.replace(/^\.\//, ''));
  if (!mainAssetPath.startsWith(`${rendererRoot}${path.sep}`)) {
    throw installedHostError('INSTALLED_HOST_RENDERER_MAIN_ASSET_INVALID');
  }
  requireFile(mainAssetPath, 'INSTALLED_HOST_RENDERER_MAIN_ASSET_MISSING');
  return true;
}

function verifyInstalledPrimaryHostRuntime({
  installRoot = process.env.GEWU_INSTALLED_HOST_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'gewu-gongfang'),
  executableName = process.platform === 'win32' ? '格物工坊.exe' : 'GewuGongfang',
} = {}) {
  const root = path.resolve(String(installRoot || ''));
  const appRoot = path.join(root, 'resources', 'app');
  const publicRoot = path.join(appRoot, 'public');
  requireFile(path.join(root, executableName), 'INSTALLED_HOST_EXECUTABLE_MISSING');
  requireFile(path.join(appRoot, 'package.json'), 'INSTALLED_HOST_PACKAGE_METADATA_MISSING');
  requireFile(path.join(publicRoot, 'electron.js'), 'INSTALLED_HOST_ELECTRON_MISSING');
  requireFile(path.join(publicRoot, 'primaryHostRuntimeStatus.js'), 'INSTALLED_HOST_RUNTIME_STATUS_MODULE_MISSING');
  requireFile(path.join(publicRoot, 'primaryHostRelaunchReadiness.js'), 'INSTALLED_HOST_RELAUNCH_READINESS_MODULE_MISSING');

  const metadata = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  if (metadata.desktopBuildFlavor !== 'primary-host' || metadata.desktopCapabilityManifest?.flavor !== 'primary-host') {
    throw installedHostError('INSTALLED_HOST_FLAVOR_INVALID');
  }
  const electronSource = fs.readFileSync(path.join(publicRoot, 'electron.js'), 'utf8');
  if (!electronSource.includes("require('./primaryHostRuntimeStatus')")) throw installedHostError('INSTALLED_HOST_RUNTIME_STATUS_WIRING_MISSING');
  if (!electronSource.includes("require('./primaryHostRelaunchReadiness')")) throw installedHostError('INSTALLED_HOST_RELAUNCH_READINESS_WIRING_MISSING');
  return Object.freeze({
    installRoot: root,
    flavor: 'primary-host',
    renderer: verifyInstalledRenderer(appRoot),
    runtimeStatus: true,
    relaunchReadiness: true,
  });
}

if (require.main === module) console.log(JSON.stringify(verifyInstalledPrimaryHostRuntime()));

module.exports = { verifyInstalledPrimaryHostRuntime, installedHostError };
