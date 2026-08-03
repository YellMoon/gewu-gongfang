'use strict';

const crypto = require('crypto');

function secretError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function ensureLocalSessionSigningSecret(env = process.env, bridgeSecret) {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  const normalizedBridgeSecret = String(bridgeSecret || '');
  if (Buffer.byteLength(normalizedBridgeSecret, 'utf8') < 32) {
    throw secretError('LOCAL_SESSION_SIGNING_SECRET_REQUIRED');
  }
  const derived = crypto.createHmac('sha256', normalizedBridgeSecret)
    .update('gewu-desktop-local-session-jwt-v1')
    .digest('hex');
  env.JWT_SECRET = derived;
  return derived;
}

module.exports = { ensureLocalSessionSigningSecret };
