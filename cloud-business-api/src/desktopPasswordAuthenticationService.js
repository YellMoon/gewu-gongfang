'use strict';

const { types } = require('util');

function invalid() {
  return Object.assign(new Error('desktop password authentication input is invalid'), { code: 'CLOUD_ONLINE_IDENTITY_INVALID' });
}

function rejected() {
  return Object.assign(new Error('desktop password authentication was rejected'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
}

function exact(value, keys, error = invalid) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw error();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw error();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw error();
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 8192 ? value : null;
}

function identity(value) {
  let row;
  try {
    row = exact(value, ['authorityId', 'accountId'], rejected);
  } catch (_) {
    throw rejected();
  }
  if (!text(row.authorityId) || !text(row.accountId)) throw rejected();
  return Object.freeze(row);
}

function ticket(value) {
  let row;
  try {
    row = exact(value, ['verificationToken', 'deviceChallenge'], rejected);
  } catch (_) {
    throw rejected();
  }
  if (!text(row.verificationToken) || !text(row.deviceChallenge)) throw rejected();
  return Object.freeze(row);
}

function verifiedRegistrationTicket(value) {
  let row;
  try {
    row = exact(value, ['v', 'authorityId', 'accountId', 'challenge', 'proofId', 'expiresAt'], rejected);
  } catch (_) {
    throw rejected();
  }
  if (row.v !== 1 || !text(row.authorityId) || !text(row.accountId) || !text(row.challenge)
    || !text(row.proofId) || !Number.isSafeInteger(row.expiresAt)) throw rejected();
  return Object.freeze(row);
}

function createDesktopPasswordAuthenticationService(config) {
  const settings = exact(config, ['phoneVerifier', 'resolveCanonicalAccount', 'verificationEvidenceHash', 'inspectVerificationToken', 'passwordIdentity', 'issueRegistrationTicket']);
  if (typeof settings.phoneVerifier !== 'function' || typeof settings.resolveCanonicalAccount !== 'function'
    || typeof settings.verificationEvidenceHash !== 'function' || typeof settings.inspectVerificationToken !== 'function' || typeof settings.issueRegistrationTicket !== 'function'
    || !settings.passwordIdentity || typeof settings.passwordIdentity !== 'object' || types.isProxy(settings.passwordIdentity)
    || Object.getPrototypeOf(settings.passwordIdentity) !== Object.prototype
    || typeof settings.passwordIdentity.enroll !== 'function' || typeof settings.passwordIdentity.enrollVerifiedAccount !== 'function'
    || typeof settings.passwordIdentity.verify !== 'function') throw invalid();

  const issue = value => ticket(settings.issueRegistrationTicket(identity(value)));
  return Object.freeze({
    async enroll(input) {
      const request = exact(input, ['phoneCode', 'loginName', 'password']);
      if (!text(request.phoneCode)) throw invalid();
      let phone;
      try {
        phone = await settings.phoneVerifier(request.phoneCode);
      } catch (_) {
        throw rejected();
      }
      if (!text(phone)) throw rejected();
      let verifiedIdentity;
      try {
        const evidenceHash = settings.verificationEvidenceHash(request.phoneCode);
        if (!text(evidenceHash)) throw rejected();
        verifiedIdentity = identity(await settings.resolveCanonicalAccount({ verifiedPhone: phone, verificationEvidenceHash: evidenceHash }));
        const enrolled = identity(await settings.passwordIdentity.enroll({
          verifiedPhone: phone,
          authorityId: verifiedIdentity.authorityId,
          accountId: verifiedIdentity.accountId,
          loginName: request.loginName,
          password: request.password,
        }));
        if (enrolled.authorityId !== verifiedIdentity.authorityId || enrolled.accountId !== verifiedIdentity.accountId) throw rejected();
      } catch (error) {
        if (error && error.code === 'CLOUD_ONLINE_IDENTITY_INVALID') throw error;
        throw rejected();
      }
      return issue(verifiedIdentity);
    },
    async enrollFromVerificationTicket(input) {
      const request = exact(input, ['verificationToken', 'loginName', 'password']);
      if (!text(request.verificationToken)) throw invalid();
      let verified;
      try {
        verified = verifiedRegistrationTicket(settings.inspectVerificationToken(request.verificationToken));
        const enrolled = identity(await settings.passwordIdentity.enrollVerifiedAccount({
          authorityId: verified.authorityId,
          accountId: verified.accountId,
          loginName: request.loginName,
          password: request.password,
        }));
        if (enrolled.authorityId !== verified.authorityId || enrolled.accountId !== verified.accountId) throw rejected();
      } catch (error) {
        if (error && error.code === 'CLOUD_ONLINE_IDENTITY_INVALID') throw error;
        throw rejected();
      }
      return Object.freeze({ verificationToken: request.verificationToken, deviceChallenge: verified.challenge });
    },
    async verify(input) {
      const request = exact(input, ['loginType', 'login', 'password']);
      let verifiedIdentity;
      try {
        verifiedIdentity = identity(await settings.passwordIdentity.verify(request));
      } catch (_) {
        throw rejected();
      }
      return issue(verifiedIdentity);
    },
  });
}

module.exports = Object.freeze({ createDesktopPasswordAuthenticationService });
