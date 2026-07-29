'use strict';

const path = require('path');

function buildIsolatedHostIdentityConfig({ root, backendPort, deviceId } = {}) {
  const profileRoot = path.resolve(String(root || ''));
  if (!profileRoot || profileRoot === path.parse(profileRoot).root) {
    throw new Error('HOST_IDENTITY_UI_PROFILE_ROOT_REQUIRED');
  }
  const port = Number(backendPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('HOST_IDENTITY_UI_PROFILE_PORT_REQUIRED');
  }
  return Object.freeze({
    nodeRole: 'primary-host',
    primaryHostListenScope: 'loopback',
    desktopIdentityMode: 'single-user',
    deviceId: String(deviceId || '').trim(),
    hostBaseUrl: `http://127.0.0.1:${port}`,
    mainDbPath: path.join(profileRoot, 'data', 'scheduling.db'),
    localCachePath: path.join(profileRoot, 'question-bank-cache'),
  });
}

module.exports = { buildIsolatedHostIdentityConfig };
