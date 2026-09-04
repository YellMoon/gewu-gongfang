'use strict';

const { types } = require('util');
const { selectDesktopBusinessAccount, desktopSessionRoles } = require('./desktopBusinessAccountResolver');

function failure(code = 'CLOUD_DESKTOP_VERIFIED_ACCESS_REJECTED') {
  return Object.assign(new Error('desktop verified access was rejected'), { code });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure();
  return value;
}

function text(value, maximum = 4096) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum ? value : null;
}

function createDesktopVerifiedAccessService(config) {
  const settings = exact(config, ['inspectVerificationToken', 'readAccountContext', 'readAccountContextByPhoneHmac']);
  if (typeof settings.inspectVerificationToken !== 'function' || typeof settings.readAccountContext !== 'function'
    || typeof settings.readAccountContextByPhoneHmac !== 'function') throw failure('CLOUD_DESKTOP_VERIFIED_ACCESS_INVALID');
  return Object.freeze({
    async read(input) {
      const request = exact(input, ['verificationToken']);
      const verificationToken = text(request.verificationToken);
      if (!verificationToken) throw failure('CLOUD_DESKTOP_VERIFIED_ACCESS_INVALID');
      let ticket;
      let directAccount;
      let phoneAccount;
      try {
        ticket = exact(settings.inspectVerificationToken(verificationToken), ['authorityId', 'accountId', 'phoneHmac', 'challenge', 'proofId', 'expiresAt']);
        if (!text(ticket.authorityId, 512) || !text(ticket.accountId, 512) || !/^[0-9a-f]{64}$/u.test(ticket.phoneHmac || '')) throw failure();
        [directAccount, phoneAccount] = await Promise.all([
          settings.readAccountContext({ accountId: ticket.accountId }),
          settings.readAccountContextByPhoneHmac({ phoneHmac: ticket.phoneHmac }),
        ]);
      } catch (_) {
        throw failure();
      }
      const account = selectDesktopBusinessAccount({ directAccount, phoneAccount });
      if (account !== null && account?.status !== 'active') throw failure();
      const roles = desktopSessionRoles(account?.roles);
      if (roles.length === 0) {
        return Object.freeze({ access: 'teacher_registration_required', roles, teacherId: null });
      }
      const teacherId = account?.profile?.type === 'teacher' && text(account.profile.id, 128) ? account.profile.id : null;
      if (roles.includes('teacher') && !teacherId) throw failure();
      return Object.freeze({ access: 'allowed', roles, teacherId });
    },
  });
}

module.exports = Object.freeze({ createDesktopVerifiedAccessService });
