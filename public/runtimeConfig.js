const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_ROLES = new Set(['primary-host', 'desktop-client']);
const MANAGED_CLOUD_BASE_URL = 'https://physicsedu.xyz/cloud-business';

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
    nodeRole: 'desktop-client',
    desktopIdentityMode: 'full',
    deviceId: makeDeviceId(),
    primaryHostEpochId: '',
    primaryHostGeneration: null,
    hostBaseUrl: 'http://127.0.0.1:3001',
    cloudBaseUrl: MANAGED_CLOUD_BASE_URL,
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

  next.nodeRole = VALID_ROLES.has(next.nodeRole) ? next.nodeRole : 'desktop-client';
  next.desktopIdentityMode = 'full';
  next.deviceId = next.deviceId || defaults.deviceId;
  next.primaryHostEpochId = String(next.primaryHostEpochId || '').trim();
  const primaryHostGeneration = Number(next.primaryHostGeneration);
  next.primaryHostGeneration = Number.isSafeInteger(primaryHostGeneration) && primaryHostGeneration > 0
    ? primaryHostGeneration
    : null;
  if (next.nodeRole !== 'primary-host' || !next.primaryHostEpochId || !next.primaryHostGeneration) {
    next.primaryHostEpochId = '';
    next.primaryHostGeneration = null;
  }
  next.hostBaseUrl = trimTrailingSlash(next.hostBaseUrl || defaults.hostBaseUrl);
  next.cloudBaseUrl = next.nodeRole === 'desktop-client'
    ? trimTrailingSlash(options.managedCloudBaseUrl || isolatedE2EManagedCloudBaseUrl() || MANAGED_CLOUD_BASE_URL)
    : trimTrailingSlash(next.cloudBaseUrl || MANAGED_CLOUD_BASE_URL);
  // The former desktopSyncToken was a shared relay secret.  Managed host
  // credentials live only in the OS protected credential store; never keep a
  // relay secret in the editable runtime configuration.
  delete next.desktopSyncToken;
  next.mainDbPath = next.mainDbPath || defaults.mainDbPath;
  next.questionBankPath = trimTrailingSlash(next.questionBankPath || '');
  next.questionBankCandidatePaths = Array.from(new Set(
    (Array.isArray(next.questionBankCandidatePaths) ? next.questionBankCandidatePaths : [])
      .map(trimTrailingSlash)
      .filter(Boolean)
  ));
  if (next.questionBankPath && !next.questionBankCandidatePaths.includes(next.questionBankPath)) {
    next.questionBankCandidatePaths.unshift(next.questionBankPath);
  }
  next.questionBankStoreId = String(next.questionBankStoreId || '').trim();
  next.localCachePath = trimTrailingSlash(next.localCachePath || defaults.localCachePath);
  next.nasBackupPath = trimTrailingSlash(next.nasBackupPath || '');
  next.questionAssetPath = trimTrailingSlash(
    next.questionAssetPath || (next.questionBankPath ? path.join(next.questionBankPath, 'assets') : '')
  );

  return next;
}

function readRuntimeConfig(configPath, options = {}) {
  let raw = {};
  if (fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return normalizeRuntimeConfig(raw, options);
}

function ensureRuntimeConfig(configPath, options = {}) {
  if (fs.existsSync(configPath)) return readRuntimeConfig(configPath, options);
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
      nodeRole: 'desktop-client',
      primaryHostEpochId: '',
      primaryHostGeneration: null,
    }, options);
  const normalized = normalizeRuntimeConfig({
    ...current,
    ...(config || {}),
    deviceId: current.deviceId,
    nodeRole: current.nodeRole,
    primaryHostEpochId: current.primaryHostEpochId,
    primaryHostGeneration: current.primaryHostGeneration,
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
  if (current.primaryHostEpochId || current.primaryHostGeneration) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_BOOTSTRAP_CONFLICT');
  }
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
    nodeRole: 'primary-host',
    primaryHostEpochId: '',
    primaryHostGeneration: null,
  }, options));
}

function writeManagedHostRuntimeConfig(configPath, identity = {}, options = {}) {
  const current = fs.existsSync(configPath)
    ? readRuntimeConfig(configPath, options)
    : normalizeRuntimeConfig({ deviceId: identity.deviceId }, options);
  const deviceId = String(identity.deviceId || '').trim();
  const epochId = String(identity.epochId || '').trim();
  const generation = Number(identity.generation);
  if (!deviceId || current.deviceId !== deviceId) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH');
  }
  if (!epochId || epochId.length > 128 || !Number.isSafeInteger(generation) || generation < 1) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_EPOCH_INVALID');
  }
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
    nodeRole: 'primary-host',
    primaryHostEpochId: epochId,
    primaryHostGeneration: generation,
  }, options));
}

function writeManagedClientRuntimeConfig(configPath, identity = {}, options = {}) {
  const current = readRuntimeConfig(configPath, options);
  const deviceId = String(identity.deviceId || '').trim();
  const expectedEpochId = String(identity.expectedEpochId || '').trim();
  if (!deviceId || current.deviceId !== deviceId) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_DEVICE_MISMATCH');
  }
  if (expectedEpochId && current.primaryHostEpochId !== expectedEpochId) {
    throw runtimeConfigError('PRIMARY_HOST_RUNTIME_EPOCH_MISMATCH');
  }
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
    nodeRole: 'desktop-client',
    primaryHostEpochId: '',
    primaryHostGeneration: null,
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
  env.GEWU_NODE_ROLE = config.nodeRole;
  env.GEWU_DESKTOP_IDENTITY_MODE = 'full';
  env.GEWU_DEVICE_ID = config.deviceId;
  delete env.GEWU_PRIMARY_HOST_EPOCH_ID;
  delete env.GEWU_PRIMARY_HOST_GENERATION;
  if (config.nodeRole === 'primary-host' && config.primaryHostEpochId && config.primaryHostGeneration) {
    env.GEWU_PRIMARY_HOST_EPOCH_ID = config.primaryHostEpochId;
    env.GEWU_PRIMARY_HOST_GENERATION = String(config.primaryHostGeneration);
  }
  env.GEWU_HOST_BASE_URL = config.hostBaseUrl || '';
  env.GEWU_CLOUD_BASE_URL = config.cloudBaseUrl || '';
  delete env.GEWU_DESKTOP_SYNC_TOKEN;
  delete env.GEWU_CLOUD_RELAY_HOST_TOKEN;
  env.DB_PATH = config.mainDbPath;
  if (config.questionBankPath) env.QUESTION_BANK_ROOT = config.questionBankPath;
  if (config.questionAssetPath) env.QUESTION_BANK_UPLOAD_DIR = config.questionAssetPath;
  if (config.questionBankCandidatePaths?.length) {
    env.QUESTION_BANK_CANDIDATE_ROOTS = config.questionBankCandidatePaths.join(';');
  }
  if (config.questionBankStoreId) env.QUESTION_BANK_STORE_ID = config.questionBankStoreId;
  if (config.localCachePath) env.GEWU_LOCAL_CACHE_PATH = config.localCachePath;
  if (config.nasBackupPath) env.GEWU_NAS_BACKUP_PATH = config.nasBackupPath;
  return env;
}

module.exports = {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  ensureRuntimeConfig,
  writeRuntimeConfig,
  writeManagedHostBootstrapRuntimeConfig,
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  writeManagedDesktopIdentityMode,
  applyRuntimeConfigToEnv,
  MANAGED_CLOUD_BASE_URL,
};
