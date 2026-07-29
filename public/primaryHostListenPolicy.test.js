'use strict';

const assert = require('assert');
const { resolveEmbeddedListenHost } = require('./primaryHostListenPolicy');

assert.strictEqual(
  resolveEmbeddedListenHost({ nodeRole: 'desktop-client' }),
  '127.0.0.1',
  'ordinary desktops are always loopback-only'
);

assert.strictEqual(
  resolveEmbeddedListenHost({ nodeRole: 'primary-host', config: {} }),
  '0.0.0.0',
  'primary hosts preserve LAN behavior unless the configuration opts out'
);

assert.strictEqual(
  resolveEmbeddedListenHost({
    nodeRole: 'primary-host',
    config: { primaryHostListenScope: 'loopback' },
  }),
  '127.0.0.1',
  'an explicit cloud-only test host must never bind an inbound network interface'
);

assert.throws(
  () => resolveEmbeddedListenHost({
    nodeRole: 'primary-host',
    config: { primaryHostListenScope: 'invalid' },
  }),
  error => error && error.code === 'PRIMARY_HOST_LISTEN_SCOPE_INVALID'
);

console.log('primary host listen policy tests passed');
