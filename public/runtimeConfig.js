const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_ROLES = new Set(['primary-host', 'desktop-client']);

function trimTrailingSlash(value) {
  return String(value || '').replace(/[\\/]+$/, '');
}

function makeDeviceId() {
  return `desktop_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function defaultConfig(userDataPath) {
  return {
    nodeRole: 'desktop-client',
    deviceId: makeDeviceId(),
    hostBaseUrl: 'http://127.0.0.1:3001',
    cloudBaseUrl: '',
    mainDbPath: path.join(userDataPath, 'data', 'scheduling.db'),
    questionBankPath: '',
    questionAssetPath: '',
  };
}

function normalizeRuntimeConfig(input = {}, options = {}) {
  const userDataPath = options.userDataPath || process.cwd();
  const defaults = defaultConfig(userDataPath);
  const next = { ...defaults, ...(input || {}) };

  next.nodeRole = VALID_ROLES.has(next.nodeRole) ? next.nodeRole : 'desktop-client';
  next.deviceId = next.deviceId || defaults.deviceId;
  next.hostBaseUrl = trimTrailingSlash(next.hostBaseUrl || defaults.hostBaseUrl);
  next.cloudBaseUrl = trimTrailingSlash(next.cloudBaseUrl || '');
  next.mainDbPath = next.mainDbPath || defaults.mainDbPath;
  next.questionBankPath = trimTrailingSlash(next.questionBankPath || '');
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

function writeRuntimeConfig(configPath, config, options = {}) {
  const normalized = normalizeRuntimeConfig(config, options);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function applyRuntimeConfigToEnv(config, env = process.env) {
  env.GEWU_NODE_ROLE = config.nodeRole;
  env.GEWU_DEVICE_ID = config.deviceId;
  env.GEWU_HOST_BASE_URL = config.hostBaseUrl || '';
  env.GEWU_CLOUD_BASE_URL = config.cloudBaseUrl || '';
  env.DB_PATH = config.mainDbPath;
  if (config.questionBankPath) env.QUESTION_BANK_ROOT = config.questionBankPath;
  if (config.questionAssetPath) env.QUESTION_BANK_UPLOAD_DIR = config.questionAssetPath;
  return env;
}

module.exports = {
  normalizeRuntimeConfig,
  readRuntimeConfig,
  writeRuntimeConfig,
  applyRuntimeConfigToEnv,
};
