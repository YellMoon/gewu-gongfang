const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_ROLES = new Set(['primary-host', 'desktop-client']);
const DESKTOP_IDENTITY_MODES = new Set(['full', 'single-user']);
const MANAGED_CLOUD_BASE_URL = 'https://physicsedu.xyz/scheduling';

function trimTrailingSlash(value) {
  return String(value || '').replace(/[\\/]+$/, '');
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
    desktopSyncToken: '',
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
  next.desktopIdentityMode = options.primaryHostCapable === true
    && DESKTOP_IDENTITY_MODES.has(next.desktopIdentityMode)
    ? next.desktopIdentityMode
    : 'full';
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
    ? trimTrailingSlash(options.managedCloudBaseUrl || MANAGED_CLOUD_BASE_URL)
    : trimTrailingSlash(next.cloudBaseUrl || MANAGED_CLOUD_BASE_URL);
  next.desktopSyncToken = String(next.desktopSyncToken || '').trim();
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
  if (!DESKTOP_IDENTITY_MODES.has(normalizedMode)) {
    throw runtimeConfigError('DESKTOP_IDENTITY_MODE_INVALID');
  }
  const current = readRuntimeConfig(configPath, options);
  return persistRuntimeConfig(configPath, normalizeRuntimeConfig({
    ...current,
    desktopIdentityMode: normalizedMode,
  }, options));
}

function deriveScopedSecret(seed, scope) {
  return crypto.createHmac('sha256', seed).update(`gewu-desktop-runtime:${scope}`).digest('hex');
}

function applyRuntimeConfigToEnv(config, env = process.env) {
  env.GEWU_NODE_ROLE = config.nodeRole;
  env.GEWU_DESKTOP_IDENTITY_MODE = DESKTOP_IDENTITY_MODES.has(config.desktopIdentityMode)
    ? config.desktopIdentityMode
    : 'full';
  env.GEWU_DEVICE_ID = config.deviceId;
  delete env.GEWU_PRIMARY_HOST_EPOCH_ID;
  delete env.GEWU_PRIMARY_HOST_GENERATION;
  if (config.nodeRole === 'primary-host' && config.primaryHostEpochId && config.primaryHostGeneration) {
    env.GEWU_PRIMARY_HOST_EPOCH_ID = config.primaryHostEpochId;
    env.GEWU_PRIMARY_HOST_GENERATION = String(config.primaryHostGeneration);
  }
  env.GEWU_HOST_BASE_URL = config.hostBaseUrl || '';
  env.GEWU_CLOUD_BASE_URL = config.cloudBaseUrl || '';
  if (config.desktopSyncToken) {
    env.GEWU_DESKTOP_SYNC_TOKEN = config.desktopSyncToken;
    if (Buffer.byteLength(config.desktopSyncToken, 'utf8') >= 32) {
      if (!env.JWT_SECRET) env.JWT_SECRET = deriveScopedSecret(config.desktopSyncToken, 'jwt');
      if (!env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET) {
        env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET = deriveScopedSecret(config.desktopSyncToken, 'artifact-download');
      }
    }
  }
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
  writeManagedHostRuntimeConfig,
  writeManagedClientRuntimeConfig,
  writeManagedDesktopIdentityMode,
  applyRuntimeConfigToEnv,
  MANAGED_CLOUD_BASE_URL,
};
