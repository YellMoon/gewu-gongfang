'use strict';

const LOOPBACK_HOST = '127.0.0.1';
const LAN_HOST = '0.0.0.0';

function resolveEmbeddedListenHost({ nodeRole, config = {} } = {}) {
  if (nodeRole !== 'primary-host') return LOOPBACK_HOST;
  const scope = String(config.primaryHostListenScope || 'lan').trim().toLowerCase();
  if (scope === 'lan') return LAN_HOST;
  if (scope === 'loopback') return LOOPBACK_HOST;
  const error = new Error('PRIMARY_HOST_LISTEN_SCOPE_INVALID');
  error.code = 'PRIMARY_HOST_LISTEN_SCOPE_INVALID';
  throw error;
}

module.exports = { LOOPBACK_HOST, LAN_HOST, resolveEmbeddedListenHost };
