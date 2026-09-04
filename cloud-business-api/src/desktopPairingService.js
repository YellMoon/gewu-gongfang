'use strict';

const crypto = require('crypto');
const { types } = require('util');

function pairingError(code = 'CLOUD_DESKTOP_PAIRING_REJECTED') {
  return Object.assign(new Error(code), { code });
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
  const settings = exact(config, [
    'now', 'randomId', 'resolveWechatIdentity', 'issueVerificationForVerifiedAccount',
    'inspectVerificationToken', 'generateLoginCode',
  ]);
  if (typeof settings.now !== 'function' || typeof settings.randomId !== 'function'
    || typeof settings.resolveWechatIdentity !== 'function'
    || typeof settings.issueVerificationForVerifiedAccount !== 'function'
    || typeof settings.inspectVerificationToken !== 'function'
    || typeof settings.generateLoginCode !== 'function') throw pairingError();
  const attempts = new Map();
  const pairingIdsByScene = new Map();

  function removeAttempt(attempt) {
    attempts.delete(attempt.pairingId);
    pairingIdsByScene.delete(attempt.scene);
  }

  function authorize(input) {
    const request = exact(input, ['pairingId', 'pairingSecret']);
    const pairingId = text(request.pairingId, 256);
    const pairingSecret = text(request.pairingSecret, 512);
    const attempt = pairingId && attempts.get(pairingId);
    const now = currentDate(settings.now);
    if (!attempt || !pairingSecret || !constantTimeMatch(attempt.secret, pairingSecret)
      || now.getTime() >= attempt.expiresAt) {
      if (attempt && now.getTime() >= attempt.expiresAt) removeAttempt(attempt);
      throw pairingError();
    }
    return { attempt, now };
  }

  return Object.freeze({
    async start(input) {
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
      const expiresAtIso = new Date(expiresAt).toISOString();
      const scene = `d_${crypto.createHash('sha256').update(`${pairingId}\0${pairingSecret}`, 'utf8').digest('base64url').slice(0, 30)}`;
      if (pairingIdsByScene.has(scene)) throw pairingError();
      let qrImageDataUrl;
      try {
        qrImageDataUrl = text(await settings.generateLoginCode({ scene }), 8 * 1024 * 1024);
      } catch (_) {
        throw pairingError('CLOUD_DESKTOP_PAIRING_UNAVAILABLE');
      }
      if (!qrImageDataUrl || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(qrImageDataUrl)) {
        throw pairingError('CLOUD_DESKTOP_PAIRING_UNAVAILABLE');
      }
      const attempt = Object.freeze({
        pairingId,
        scene,
        secret: pairingSecret,
        expiresAt,
        registration: Object.freeze({ installationId, installationPublicKey, idempotencyKey }),
        verificationToken: null,
        deviceChallenge: null,
      });
      attempts.set(pairingId, attempt);
      pairingIdsByScene.set(scene, pairingId);
      return Object.freeze({ pairingId, pairingSecret, expiresAt: expiresAtIso, qrImageDataUrl });
    },
    read(input) {
      const { attempt } = authorize(input);
      return attempt.verificationToken
        ? Object.freeze({ status: 'verified', verificationToken: attempt.verificationToken, deviceChallenge: attempt.deviceChallenge })
        : Object.freeze({ status: 'awaiting_online_verification' });
    },
    async confirm(input) {
      const request = exact(input, ['scene', 'loginCode', 'phoneCode']);
      const scene = text(request.scene, 32);
      if (!scene || !/^d_[A-Za-z0-9_-]{30}$/u.test(scene)) throw pairingError();
      const pairingId = pairingIdsByScene.get(scene);
      const attempt = pairingId && attempts.get(pairingId);
      const now = currentDate(settings.now);
      if (!attempt || now.getTime() >= attempt.expiresAt) {
        if (attempt) removeAttempt(attempt);
        throw pairingError();
      }
      if (attempt.verificationToken) return Object.freeze({ status: 'verified' });
      const loginCode = text(request.loginCode, 512);
      const phoneCode = text(request.phoneCode, 512);
      if (!loginCode || !phoneCode) throw pairingError();
      let identity;
      try {
        identity = exact(await settings.resolveWechatIdentity({ loginCode, phoneCode }), ['authorityId', 'accountId', 'phoneHmac']);
      } catch (_) {
        throw pairingError();
      }
      if (!text(identity.authorityId, 512) || !text(identity.accountId, 512)
        || !/^[0-9a-f]{64}$/u.test(identity.phoneHmac)) throw pairingError();
      let verification;
      try {
        verification = exact(settings.issueVerificationForVerifiedAccount(identity), ['verificationToken', 'deviceChallenge']);
      } catch (_) {
        throw pairingError();
      }
      const verificationToken = text(verification.verificationToken, 4096);
      const issuedDeviceChallenge = text(verification.deviceChallenge, 4096);
      if (!verificationToken || !issuedDeviceChallenge) throw pairingError();
      let ticket;
      try {
        ticket = settings.inspectVerificationToken(verificationToken);
      } catch (_) {
        throw pairingError();
      }
      const deviceChallenge = text(ticket?.challenge, 4096);
      if (!deviceChallenge || !constantTimeMatch(deviceChallenge, issuedDeviceChallenge)) throw pairingError();
      attempts.set(attempt.pairingId, Object.freeze({ ...attempt, verificationToken, deviceChallenge }));
      return Object.freeze({ status: 'verified' });
    },
  });
}

module.exports = Object.freeze({ createDesktopPairingService });
