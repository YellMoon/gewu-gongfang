'use strict';

const assert = require('assert');
const path = require('path');
const { buildIsolatedHostIdentityConfig } = require('./hostIdentityUiProfile');

const root = path.join(process.cwd(), 'tmp-host-identity-profile-test');
const config = buildIsolatedHostIdentityConfig({
  root,
  backendPort: 41873,
  deviceId: 'host-identity-ui-test',
});

assert.strictEqual(config.nodeRole, 'primary-host');
assert.strictEqual(config.desktopIdentityMode, 'single-user');
assert.strictEqual(config.primaryHostListenScope, 'loopback',
  'the disposable identity-only host must never request a LAN listener');
assert.strictEqual(config.hostBaseUrl, 'http://127.0.0.1:41873');
assert.strictEqual(config.mainDbPath, path.join(root, 'data', 'scheduling.db'));

console.log('host identity UI profile contract passed');
