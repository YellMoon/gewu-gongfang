'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function text(value, code, maxLength = 512) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > maxLength) {
    throw failure(code);
  }
  return value;
}

function parseDesktopPairingCode(value) {
  const raw = text(value, 'CLOUD_DESKTOP_PAIRING_CODE_INVALID', 2048);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw failure('CLOUD_DESKTOP_PAIRING_CODE_INVALID');
  }
  if (parsed.protocol !== 'gewu:' || parsed.hostname !== 'desktop-pairing' || !['', '/'].includes(parsed.pathname)) {
    throw failure('CLOUD_DESKTOP_PAIRING_CODE_INVALID');
  }
  const pairingId = text(parsed.searchParams.get('pairingId'), 'CLOUD_DESKTOP_PAIRING_CODE_INVALID', 256);
  const pairingSecret = text(parsed.searchParams.get('secret'), 'CLOUD_DESKTOP_PAIRING_CODE_INVALID', 512);
  if (Array.from(parsed.searchParams.keys()).sort().join(',') !== 'pairingId,secret') {
    throw failure('CLOUD_DESKTOP_PAIRING_CODE_INVALID');
  }
  return Object.freeze({ pairingId, pairingSecret });
}

function buildPairingConfirmation(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('CLOUD_DESKTOP_PAIRING_CODE_INVALID');
  return Object.freeze({
    pairingId: text(input.pairingId, 'CLOUD_DESKTOP_PAIRING_CODE_INVALID', 256),
    pairingSecret: text(input.pairingSecret, 'CLOUD_DESKTOP_PAIRING_CODE_INVALID', 512),
    phoneCode: text(input.phoneCode, 'CLOUD_DESKTOP_PAIRING_PHONE_PROOF_REQUIRED', 512),
  });
}

module.exports = Object.freeze({ buildPairingConfirmation, parseDesktopPairingCode });
