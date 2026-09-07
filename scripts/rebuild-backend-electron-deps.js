'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

async function main() {
  const root = path.resolve(__dirname, '..');
  const backend = path.join(root, 'backend');
  // Use the same installed builder implementation as install-app-deps, but
  // point it at the backend's actual production dependency tree as well.
  const { installOrRebuild } = require('app-builder-lib/out/util/yarn');
  const { createLazyProductionDeps } = require('app-builder-lib/out/util/packageDependencies');
  await installOrRebuild({}, backend, {
    frameworkInfo: { version: require('electron/package.json').version, useCustomDist: true },
    platform: process.platform, arch: process.arch,
    productionDeps: createLazyProductionDeps(backend, null),
  }, false);
  const result = spawnSync(require('electron'), [path.join(__dirname, 'verify-electron-native-abi.js')], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`DESKTOP_NATIVE_ABI_FAILED:${result.status}`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
