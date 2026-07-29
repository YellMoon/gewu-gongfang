const fs = require('fs');
const os = require('os');
const path = require('path');

const PROFILE_MARKER = '.gewu-isolated-primary-host-profile.json';

function profileError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isStrictChild(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function createIsolatedPrimaryHostProfile({ root, profilePath, hostPort = 60462, cloudBaseUrl = 'https://physicsedu.xyz/scheduling' } = {}) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedRoot = path.resolve(String(root || ''));
  const resolvedProfile = path.resolve(String(profilePath || ''));
  if (!root || !profilePath || !isStrictChild(tempRoot, resolvedRoot) || !isStrictChild(resolvedRoot, resolvedProfile)) {
    throw profileError('ISOLATED_PROFILE_PATH_INVALID');
  }
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw profileError('ISOLATED_PROFILE_ROOT_REQUIRED');
  }
  if (fs.existsSync(resolvedProfile)) throw profileError('ISOLATED_PROFILE_ALREADY_EXISTS');
  const port = Number(hostPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw profileError('ISOLATED_PROFILE_PORT_INVALID');
  const managedCloudBaseUrl = String(cloudBaseUrl || '').trim().replace(/\/+$/, '');
  const defaultCloudBaseUrl = 'https://physicsedu.xyz/scheduling';
  if (managedCloudBaseUrl !== defaultCloudBaseUrl && !/^http:\/\/127\.0\.0\.1:\d+$/.test(managedCloudBaseUrl)) {
    throw profileError('ISOLATED_PROFILE_CLOUD_URL_INVALID');
  }
  fs.mkdirSync(resolvedProfile, { recursive: false });
  const marker = {
    kind: 'gewu-isolated-primary-host-profile',
    createdAt: new Date().toISOString(),
    testOnly: true,
  };
  const config = {
    nodeRole: 'primary-host',
    desktopIdentityMode: 'full',
    deviceId: 'isolated-primary-host-device',
    primaryHostEpochId: '',
    primaryHostGeneration: null,
    hostBaseUrl: `http://127.0.0.1:${port}`,
    cloudBaseUrl: managedCloudBaseUrl,
    managedCloudBaseUrl,
    mainDbPath: path.join(resolvedProfile, 'data', 'scheduling.db'),
    questionBankPath: '',
    questionAssetPath: '',
    questionBankCandidatePaths: [],
    questionBankStoreId: '',
    localCachePath: path.join(resolvedProfile, 'question-bank-cache'),
    nasBackupPath: '',
  };
  fs.writeFileSync(path.join(resolvedProfile, PROFILE_MARKER), JSON.stringify(marker), { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(path.join(resolvedProfile, 'gewugongfang.config.json'), JSON.stringify(config, null, 2), { encoding: 'utf8', flag: 'wx' });
  return Object.freeze({ profilePath: resolvedProfile, configPath: path.join(resolvedProfile, 'gewugongfang.config.json'), markerPath: path.join(resolvedProfile, PROFILE_MARKER) });
}

module.exports = { PROFILE_MARKER, createIsolatedPrimaryHostProfile, profileError };
