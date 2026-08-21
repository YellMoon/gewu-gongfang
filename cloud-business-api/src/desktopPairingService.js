'use strict';

const crypto = require('crypto');
const { types } = require('util');

function pairingError() {
  return Object.assign(new Error('desktop pairing was rejected'), { code: 'CLOUD_DESKTOP_PAIRING_REJECTED' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw pairingError();
  }
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw pairingError();
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value, maxLength = 256) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function currentDate(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw pairingError();
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeMatch(expected, supplied) {
  const left = digest(expected);
  const right = digest(supplied);
  return crypto.timingSafeEqual(left, right);
}

function createDesktopPairingService(config) {
  const settings = exact(config, ['now', 'randomId', 'beginOnlineVerification']);
  if (typeof settings.now !== 'function' || typeof settings.randomId !== 'function'
    || typeof settings.beginOnlineVerification !== 'function') throw pairingError();
  const attempts = new Map();

  function authorize(input) {
    const request = exact(input, ['pairingId', 'pairingSecret']);
    const pairingId = text(request.pairingId, 256);
    const pairingSecret = text(request.pairingSecret, 512);
    const attempt = pairingId && attempts.get(pairingId);
    const now = currentDate(settings.now);
    if (!attempt || !pairingSecret || !constantTimeMatch(attempt.secret, pairingSecret)
      || now.getTime() >= attempt.expiresAt) {
      if (attempt && now.getTime() >= attempt.expiresAt) attempts.delete(pairingId);
      throw pairingError();
    }
    return { attempt, now };
  }

  return Object.freeze({
    start(input) {
      const request = exact(input, ['installationId', 'installationPublicKey', 'idempotencyKey']);
      const installationId = text(request.installationId, 256);
      const installationPublicKey = text(request.installationPublicKey, 8192);
      const idempotencyKey = text(request.idempotencyKey, 256);
      if (!installationId || !installationPublicKey || !idempotencyKey) throw pairingError();
      const pairingId = text(String(settings.randomId('desktop-pairing-id')), 256);
      const pairingSecret = text(String(settings.randomId('desktop-pairing-secret')), 512);
      const now = currentDate(settings.now);
      if (!pairingId || !pairingSecret || attempts.has(pairingId)) throw pairingError();
      const expiresAt = now.getTime() + 5 * 60 * 1000;
      attempts.set(pairingId, Object.freeze({
        pairingId,
        secret: pairingSecret,
        expiresAt,
        registration: Object.freeze({ installationId, installationPublicKey, idempotencyKey }),
        verificationToken: null,
      }));
      return Object.freeze({ pairingId, pairingSecret, expiresAt: new Date(expiresAt).toISOString() });
    },
    read(input) {
      const { attempt } = authorize(input);
      return attempt.verificationToken
        ? Object.freeze({ status: 'verified', verificationToken: attempt.verificationToken })
        : Object.freeze({ status: 'awaiting_online_verification' });
    },
    async confirm(input) {
      const request = exact(input, ['pairingId', 'pairingSecret', 'phoneCode']);
      const { attempt } = authorize({ pairingId: request.pairingId, pairingSecret: request.pairingSecret });
      if (attempt.verificationToken) return Object.freeze({ status: 'verified' });
      const phoneCode = text(request.phoneCode, 512);
      if (!phoneCode) throw pairingError();
      let verification;
      try {
        verification = await settings.beginOnlineVerification({ phoneCode });
      } catch (_) {
        throw pairingError();
      }
      const verificationToken = text(verification?.verificationToken, 4096);
      if (!verificationToken) throw pairingError();
      attempts.set(attempt.pairingId, Object.freeze({ ...attempt, verificationToken }));
      return Object.freeze({ status: 'verified' });
    },
  });
}

module.exports = Object.freeze({ createDesktopPairingService });
