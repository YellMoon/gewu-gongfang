const crypto = require('crypto');
const { stableJson } = require('./authorityProtocol');

const HTTP_AUTH_PROTOCOL = 'gewu.authority-http-auth.v1';

function httpAuthError(code) {
  return Object.assign(new Error(code), { code });
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function authorityHttpSigningPayload({ method, path, actor, body = null } = {}) {
  const normalizedMethod = String(method || '').trim().toUpperCase();
  const normalizedPath = String(path || '').trim();
  if (!normalizedMethod || !normalizedPath || !nonEmpty(actor?.userId)
    || !nonEmpty(actor?.deviceId) || !nonEmpty(actor?.role)) {
    throw httpAuthError('AUTHORITY_HTTP_AUTH_INPUT_INVALID');
  }
  return stableJson({
    protocol: HTTP_AUTH_PROTOCOL,
    method: normalizedMethod,
    path: normalizedPath,
    actor: {
      userId: actor.userId.trim(),
      deviceId: actor.deviceId.trim(),
      role: actor.role.trim(),
    },
    body: body === undefined ? null : body,
  });
}

function verifyAuthorityHttpSignature({ publicKey, signature, ...request } = {}) {
  if (!nonEmpty(publicKey) || !nonEmpty(signature)) {
    throw httpAuthError('AUTHORITY_DEVICE_SIGNATURE_REQUIRED');
  }
  let verified = false;
  try {
    verified = crypto.verify(
      null,
      Buffer.from(authorityHttpSigningPayload(request), 'utf8'),
      crypto.createPublicKey(publicKey),
      Buffer.from(signature, 'base64'),
    );
  } catch (_error) {
    verified = false;
  }
  if (!verified) throw httpAuthError('AUTHORITY_DEVICE_SIGNATURE_INVALID');
  return true;
}

module.exports = {
  HTTP_AUTH_PROTOCOL,
  authorityHttpSigningPayload,
  httpAuthError,
  verifyAuthorityHttpSignature,
};
