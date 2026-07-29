'use strict';

const fs = require('fs');
const path = require('path');
const { verifyInstalledPrimaryHostRuntime } = require('./verify-installed-primary-host-runtime');

function promotionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function resolveRequired(value, code) {
  const normalized = String(value || '').trim();
  if (!normalized) throw promotionError(code);
  return path.resolve(normalized);
}

function assertDistinct(paths) {
  const values = Object.values(paths);
  if (new Set(values).size !== values.length) throw promotionError('HOST_RUNTIME_PROMOTION_PATH_CONFLICT');
}

function promotePrimaryHostRuntime({
  sourceRoot = process.env.GEWU_HOST_RUNTIME_SOURCE,
  installRoot = process.env.GEWU_INSTALLED_HOST_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'gewu-gongfang'),
  stagingRoot = process.env.GEWU_HOST_RUNTIME_STAGE,
  rollbackRoot = process.env.GEWU_HOST_RUNTIME_ROLLBACK,
  executableName = process.platform === 'win32' ? '\u683c\u7269\u5de5\u574a.exe' : 'GewuGongfang',
} = {}) {
  const source = resolveRequired(sourceRoot, 'HOST_RUNTIME_SOURCE_REQUIRED');
  const installed = resolveRequired(installRoot, 'HOST_RUNTIME_INSTALL_ROOT_REQUIRED');
  const stage = resolveRequired(stagingRoot || `${installed}.stage`, 'HOST_RUNTIME_STAGE_ROOT_REQUIRED');
  const rollback = resolveRequired(rollbackRoot || `${installed}.rollback`, 'HOST_RUNTIME_ROLLBACK_ROOT_REQUIRED');
  assertDistinct({ source, installed, stage, rollback });

  // Verify both before and after copy. A directory being present is not enough:
  // the renderer entry and its referenced JS bundle are required runtime files.
  verifyInstalledPrimaryHostRuntime({ installRoot: source, executableName });
  if (fs.existsSync(stage)) throw promotionError('HOST_RUNTIME_STAGE_EXISTS');
  if (fs.existsSync(rollback)) throw promotionError('HOST_RUNTIME_ROLLBACK_EXISTS');

  fs.cpSync(source, stage, { recursive: true, force: false, errorOnExist: true, dereference: false });
  verifyInstalledPrimaryHostRuntime({ installRoot: stage, executableName });

  const hadInstalledRuntime = fs.existsSync(installed);
  if (hadInstalledRuntime) fs.renameSync(installed, rollback);
  try {
    fs.renameSync(stage, installed);
  } catch (error) {
    if (hadInstalledRuntime && fs.existsSync(rollback) && !fs.existsSync(installed)) fs.renameSync(rollback, installed);
    throw error;
  }

  try {
    const verified = verifyInstalledPrimaryHostRuntime({ installRoot: installed, executableName });
    return Object.freeze({ installRoot: installed, rollbackRoot: hadInstalledRuntime ? rollback : null, renderer: verified.renderer });
  } catch (error) {
    // Do not leave a bad promoted tree at the stable executable path. Keep it at
    // the stage path for inspection and atomically restore the known rollback.
    if (hadInstalledRuntime && fs.existsSync(rollback) && fs.existsSync(installed)) {
      fs.renameSync(installed, stage);
      fs.renameSync(rollback, installed);
    }
    throw error;
  }
}

if (require.main === module) console.log(JSON.stringify(promotePrimaryHostRuntime()));

module.exports = { promotePrimaryHostRuntime, promotionError };
