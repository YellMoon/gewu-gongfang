'use strict';

// Creates only a disposable ordinary-desktop profile for packaged UI checks.
// It intentionally refuses normal profiles so real desktop data is never touched.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function isDisposableProfile(root, config) {
  return path.basename(root).startsWith('tmp-real-desktop-client-')
    && String(config.deviceId || '').startsWith('real_e2e_');
}

function main() {
  const configPath = path.resolve(process.argv[2] || '');
  const hostBaseUrl = String(process.argv[3] || '').replace(/\/+$/, '');
  const managedCloudBaseUrl = String(process.argv[4] || 'https://physicsedu.xyz/scheduling').replace(/\/+$/, '');
  const deviceId = String(process.argv[5] || 'real_e2e_packaged_client_ui').trim();
  assert(path.basename(configPath) === 'gewugongfang.config.json', 'TEST_CONFIG_PATH_REQUIRED');
  assert(/^http:\/(?:\/127\.0\.0\.1|\/192\.168\.\d{1,3}\.\d{1,3}):\d+$/.test(hostBaseUrl), 'TEST_HOST_URL_REQUIRED');
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(managedCloudBaseUrl), 'TEST_MANAGED_CLOUD_URL_REQUIRED');
  assert(/^real_e2e_[a-z0-9_]{3,128}$/.test(deviceId), 'TEST_DEVICE_ID_REQUIRED');
  const profileRoot = path.dirname(configPath);
  const config = {
    nodeRole: 'desktop-client',
    desktopIdentityMode: 'full',
    deviceId,
    primaryHostEpochId: '',
    primaryHostGeneration: null,
    hostBaseUrl,
    cloudBaseUrl: managedCloudBaseUrl,
    managedCloudBaseUrl,
    mainDbPath: path.join(profileRoot, 'data', 'scheduling.db'),
    questionBankPath: '',
    questionAssetPath: '',
    questionBankCandidatePaths: [],
    questionBankStoreId: '',
    localCachePath: path.join(profileRoot, 'local-cache'),
    nasBackupPath: '',
  };
  assert(isDisposableProfile(profileRoot, config), 'DISPOSABLE_TEST_PROFILE_REQUIRED');
  fs.mkdirSync(path.dirname(config.mainDbPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(JSON.stringify({ prepared: true, profile: path.basename(profileRoot), hostBaseUrl }));
}

main();
