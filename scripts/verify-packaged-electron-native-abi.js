'use strict';

const fs = require('fs');
const Module = require('module');
const path = require('path');
const { spawnSync } = require('child_process');

function isPackagedElectronChild(env = process.env) {
  return env.GEWU_PACKAGED_ABI_CHILD === '1';
}

function resolvePackagedPaths({ appRoot = process.env.PACKAGED_APP_ROOT, executable = process.env.PACKAGED_ELECTRON_EXE } = {}) {
  const resolvedAppRoot = String(appRoot || '').trim();
  if (!resolvedAppRoot) throw new Error('PACKAGED_APP_ROOT is required');
  const unpackedRoot = path.resolve(resolvedAppRoot, '..', '..');
  let resolvedExecutable = String(executable || '').trim();
  if (!resolvedExecutable && fs.existsSync(unpackedRoot)) {
    resolvedExecutable = fs.readdirSync(unpackedRoot)
      .find(name => name.toLowerCase().endsWith('.exe') && !name.toLowerCase().startsWith('uninstall')) || '';
    if (resolvedExecutable) resolvedExecutable = path.join(unpackedRoot, resolvedExecutable);
  }
  if (!resolvedExecutable) throw new Error('PACKAGED_ELECTRON_EXE is required');
  return Object.freeze({ appRoot: resolvedAppRoot, executable: resolvedExecutable });
}

function verifyPackagedNativeModule({ appRoot }) {
  const packagedRequire = Module.createRequire(path.join(appRoot, 'package.json'));
  const Database = packagedRequire('better-sqlite3');
  const db = new Database(':memory:');
  try {
    const row = db.prepare('SELECT 1 AS ok').get();
    if (row?.ok !== 1) throw new Error('PACKAGED_SQLITE_SMOKE_FAILED');
    console.log(`packaged Electron native ABI verified: ${process.versions.modules}`);
  } finally {
    db.close();
  }
}

function runVerifier({ env = process.env, spawn = spawnSync } = {}) {
  const paths = resolvePackagedPaths({ appRoot: env.PACKAGED_APP_ROOT, executable: env.PACKAGED_ELECTRON_EXE });
  if (isPackagedElectronChild(env)) {
    verifyPackagedNativeModule(paths);
    return;
  }
  const result = spawn(paths.executable, [__filename], {
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      GEWU_PACKAGED_ABI_CHILD: '1',
      PACKAGED_APP_ROOT: paths.appRoot,
      PACKAGED_ELECTRON_EXE: paths.executable,
    },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`PACKAGED_ELECTRON_NATIVE_ABI_FAILED:${result.status}`);
}

if (require.main === module) runVerifier();

module.exports = { isPackagedElectronChild, resolvePackagedPaths, runVerifier, verifyPackagedNativeModule };
