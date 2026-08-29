const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANAGED_CLOUD_BASE_URL = 'https://physicsedu.xyz/scheduling';
const MANAGED_CLOUD_BUSINESS_BASE_URL = 'https://physicsedu.xyz/cloud-business';

function trimTrailingSlash(value) {
  return String(value || '').replace(/[\\/]+$/, '');
}

function isolatedE2EManagedCloudBaseUrl() {
  if (process.env.GEWU_E2E_NO_AUTHORITY_DATA !== '1') return '';
  const raw = String(process.env.GEWU_E2E_MANAGED_CLOUD_BASE_URL || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost';
    if (!loopback || url.protocol !== 'http:' || !url.port) return '';
    return trimTrailingSlash(url.toString());
  } catch (_error) {
    return '';
  }
}

function makeDeviceId() {
  return `desktop_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function defaultConfig(userDataPath) {
  return {
    desktopIdentityMode: 'full',
    deviceId: makeDeviceId(),
    cloudBaseUrl: MANAGED_CLOUD_BASE_URL,
    cloudBusinessIdentityBaseUrl: MANAGED_CLOUD_BUSINESS_BASE_URL,
    mainDbPath: path.join(userDataPath, 'data', 'scheduling.db'),
    questionBankPath: '',
    questionAssetPath: '',
    questionBankCandidatePaths: [],
    questionBankStoreId: '',
    localCachePath: path.join(userDataPath, 'question-bank-cache'),
    nasBackupPath: '',
  };
}

function normalizeRuntimeConfig(input = {}, options = {}) {
  const userDataPath = options.userDataPath || process.cwd();
  const defaults = defaultConfig(userDataPath);
  const next = { ...defaults, ...(input || {}) };

  next.desktopIdentityMode = 'full';
  next.deviceId = next.deviceId || defaults.deviceId;
  next.cloudBaseUrl = trimTrailingSlash(options.managedCloudBaseUrl || isolatedE2EManagedCloudBaseUrl() || MANAGED_CLOUD_BASE_URL);
  next.cloudBusinessIdentityBaseUrl = trimTrailingSlash(
    options.managedCloudBusinessBaseUrl || MANAGED_CLOUD_BUSINESS_BASE_URL,
  );
  // The former desktopSyncToken was a shared relay secret.  Managed host
  // credentials live only in the OS protected credential store; never keep a
  // relay secret in the editable runtime configuration.
  delete next.desktopSyncToken;
  delete next.nodeRole;
  delete next.primaryHostEpochId;
  delete next.primaryHostGeneration;
  delete next.hostBaseUrl;
  // A desktop installation carries only its own disposable cache and offline
  // drafts.  Old host configurations pointed these fields at an external disk
  // or NAS share; keeping even one of those values makes a normal login depend
  // on a device that is no longer part of the product architecture.
  next.mainDbPath = defaults.mainDbPath;
  next.questionBankPath = '';
  next.questionAssetPath = '';
  next.questionBankCandidatePaths = [];
  next.questionBankStoreId = '';
  next.localCachePath = defaults.localCachePath;
  next.nasBackupPath = '';

  return next;
}

function readRuntimeConfig(configPath, options = {}) {
  let raw = {};
  if (fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return normalizeRuntimeConfig(raw, options);
}

function unreadableRuntimeConfigBackupPath(configPath) {
  const parsed = path.parse(configPath);
  const stamp = `${Date.now()}-${process.pid}`;
  return path.join(parsed.dir, `${parsed.name}.invalid-${stamp}${parsed.ext}`);
}

function recoverUnreadableRuntimeConfig(configPath, options = {}) {
  // Retain the exact bytes for support/recovery.  A runtime config has no
  // authority over business data, so a fresh managed config is safer than
  // leaving the desktop blocked at its login screen.
  fs.renameSync(configPath, unreadableRuntimeConfigBackupPath(configPath));
  return writeRuntimeConfig(configPath, {}, options);
}

function ensureRuntimeConfig(configPath, options = {}) {
  if (fs.existsSync(configPath)) {
    try {
      return readRuntimeConfig(configPath, options);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return recoverUnreadableRuntimeConfig(configPath, options);
    }
  }
  try {
    return writeRuntimeConfig(configPath, {}, options);
  } catch (error) {
    if (fs.existsSync(configPath)) return readRuntimeConfig(configPath, options);
    throw error;
  }
}

function persistRuntimeConfig(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.tmp`;
  try {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(temporary, configPath);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (_cleanupError) { /* best effort */ }
    throw error;
  }
  return config;
}

function writeRuntimeConfig(configPath, config, options = {}) {
  const exists = fs.existsSync(configPath);
  const current = exists
    ? readRuntimeConfig(configPath, options)
    : normalizeRuntimeConfig({
      ...(config || {}),
    }, options);
  const normalized = normalizeRuntimeConfig({
    ...current,
    ...(config || {}),
    deviceId: current.deviceId,
    desktopIdentityMode: current.desktopIdentityMode,
  }, options);
  return persistRuntimeConfig(configPath, normalized);
}

function runtimeConfigError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function writeManagedHostBootstrapRuntimeConfig(configPath, identity = {}, options = {}) {
  if (options.primaryHostCapable !== true) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_HOST_FLAVOR_REQUIRED');
  }
  const current = readRuntimeConfig(configPath, options);
  const deviceId = String(identity.deviceId || '').trim();
  if (!deviceId || current.deviceId !== deviceId) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH');
  }
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
  }, options));
}

function writeManagedHostRuntimeConfig(configPath, identity = {}, options = {}) {
  const current = fs.existsSync(configPath)
    ? readRuntimeConfig(configPath, options)
    : normalizeRuntimeConfig({ deviceId: identity.deviceId }, options);
  const deviceId = String(identity.deviceId || '').trim();
  if (!deviceId || current.deviceId !== deviceId) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH');
  }
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
  }, options));
}

function writeManagedClientRuntimeConfig(configPath, identity = {}, options = {}) {
  const current = readRuntimeConfig(configPath, options);
  const deviceId = String(identity.deviceId || '').trim();
  if (!deviceId || current.deviceId !== deviceId) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH');
  }
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
    desktopIdentityMode: 'full',
  }, options));
}

function writeManagedDesktopIdentityMode(configPath, mode, options = {}) {
  if (options.primaryHostCapable !== true) {
    throw runtimeConfigError('DESKTOP_IDENTITY_MODE_HOST_FLAVOR_REQUIRED');
  }
  const normalizedMode = String(mode || '').trim();
  if (normalizedMode !== 'full') throw runtimeConfigError('DESKTOP_IDENTITY_MODE_RETIRED');
  const current = readRuntimeConfig(configPath, options);
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
    desktopIdentityMode: normalizedMode,
  }, options));
}

function applyRuntimeConfigToEnv(config, env = process.env) {
  delete env.GEWU_NODE_ROLE;
  env.GEWU_DESKTOP_IDENTITY_MODE = 'full';
  env.GEWU_DEVICE_ID = config.deviceId;
  delete env.GEWU_PRIMARY_HOST_EPOCH_ID;
  delete env.GEWU_PRIMARY_HOST_GENERATION;
  delete env.GEWU_HOST_BASE_URL;
  env.GEWU_CLOUD_BASE_URL = config.cloudBaseUrl || '';
  env.GEWU_CLOUD_BUSINESS_IDENTITY_BASE_URL = config.cloudBusinessIdentityBaseUrl || '';
  delete env.GEWU_DESKTOP_SYNC_TOKEN;
  delete env.GEWU_CLOUD_RELAY_HOST_TOKEN;
  delete env.QUESTION_BANK_ROOT;
  delete env.QUESTION_BANK_UPLOAD_DIR;
  delete env.QUESTION_BANK_CANDIDATE_ROOTS;
  delete env.QUESTION_BANK_STORE_ID;
  delete env.GEWU_NAS_BACKUP_PATH;
  env.DB_PATH = config.mainDbPath;
  if (config.localCachePath) env.GEWU_LOCAL_CACHE_PATH = config.localCachePath;
  return env;
}

module.exports = {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  ensureRuntimeConfig,
  recoverUnreadableRuntimeConfig,
  writeRuntimeConfig,
  writeManagedHostBootstrapRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  writeManagedDesktopIdentityMode,
  applyRuntimeConfigToEnv,
  MANAGED_CLOUD_BASE_URL,
  MANAGED_CLOUD_BUSINESS_BASE_URL,
};
