'use strict';

const { createHash } = require('node:crypto');
const { types } = require('node:util');

function failure() {
  const error = new Error('unified desktop registration evidence is invalid');
  error.code = 'VNEXT_UNIFIED_DESKTOP_REGISTRATION_EVIDENCE_INVALID';
  return error;
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value !== '' ? value : null;
}

function createUnifiedDesktopRegistrationEvidence(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== 1 || !Object.hasOwn(value, 'sessionId')
    || !text(value.sessionId)) throw failure();
  const canonical = JSON.stringify({ sessionId: value.sessionId });
  const sha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return Object.freeze({
    canonicalResultJson: canonical,
    resultSha256: sha256,
    canonicalPayloadJson: canonical,
    payloadSha256: sha256,
  });
}

module.exports = Object.freeze({ createUnifiedDesktopRegistrationEvidence });
