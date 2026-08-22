'use strict';

const crypto = require('crypto');
const { types } = require('util');

function rejected() {
  return Object.assign(new Error('miniapp cloud identity was rejected'), { code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
}

function invalid() {
  return Object.assign(new Error('miniapp cloud identity is invalid'), { code: 'CLOUD_MINIAPP_IDENTITY_INVALID' });
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 512 ? value : null;
}

function sign(secret, value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('base64url');
}

function issue(secret, payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(secret, encoded)}`;
}

function inspect(secret, token, now) {
  if (typeof token !== 'string' || token.length > 4096) throw rejected();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw rejected();
  const expected = Buffer.from(sign(secret, parts[0]));
  const supplied = Buffer.from(parts[1]);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw rejected();
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (_) {
    throw rejected();
  }
  const copy = exact(payload, ['v', 'kind', 'accountId', 'expiresAt']);
  if (copy.v !== 1 || copy.kind !== 'miniapp-cloud' || !text(copy.accountId) || !Number.isSafeInteger(copy.expiresAt) || copy.expiresAt <= now.getTime()) throw rejected();
  return copy;
}

function identity(value) {
  const copy = exact(value, ['accountId', 'status', 'roles']);
  if (!text(copy.accountId) || !['active', 'disabled'].includes(copy.status) || !Array.isArray(copy.roles) || copy.roles.some(role => !['super_admin', 'admin', 'teacher', 'student'].includes(role)) || new Set(copy.roles).size !== copy.roles.length) throw rejected();
  return Object.freeze({ accountId: copy.accountId, status: copy.status, roles: Object.freeze(copy.roles.slice()) });
}

function publicIdentity(context) {
  if (context.status === 'disabled') throw rejected();
  return Object.freeze({ accountId: context.accountId, status: context.roles.length === 0 ? 'pending_authorization' : 'active', roles: context.roles });
}

function role(value) {
  return typeof value === 'string' && ['admin', 'teacher', 'student'].includes(value) ? value : null;
}

function createMiniappCloudAccountService(config) {
  const settings = exact(config, ['now', 'phoneVerifier', 'phoneHmac', 'bootstrapAdminPhoneHmac', 'accountRepository', 'ticketSecret']);
  if (typeof settings.now !== 'function' || typeof settings.phoneVerifier !== 'function' || typeof settings.phoneHmac !== 'function' || !/^[0-9a-f]{64}$/u.test(settings.bootstrapAdminPhoneHmac) || !settings.accountRepository || typeof settings.accountRepository.resolveOrCreate !== 'function' || typeof settings.accountRepository.readContext !== 'function' || typeof settings.accountRepository.listPending !== 'function' || typeof settings.accountRepository.assignRole !== 'function' || typeof settings.ticketSecret !== 'string' || settings.ticketSecret.length < 24) throw invalid();
  const currentNow = () => {
    const value = settings.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw invalid();
    return value;
  };
  const currentContext = async token => {
    const ticket = inspect(settings.ticketSecret, token, currentNow());
    let current;
    try {
      current = identity(await settings.accountRepository.readContext({ accountId: ticket.accountId }));
    } catch (_) {
      throw rejected();
    }
    if (current.accountId !== ticket.accountId) throw rejected();
    return publicIdentity(current);
  };
  return Object.freeze({
    async login(input) {
      const request = exact(input, ['phoneCode']);
      if (!text(request.phoneCode)) throw rejected();
      let phone;
      try {
        phone = await settings.phoneVerifier(request.phoneCode);
      } catch (_) {
        throw rejected();
      }
      let phoneHmac;
      try {
        phoneHmac = settings.phoneHmac(phone);
      } catch (_) {
        throw rejected();
      }
      if (!/^[0-9a-f]{64}$/u.test(phoneHmac)) throw rejected();
      let current;
      try {
        current = identity(await settings.accountRepository.resolveOrCreate({ phoneHmac, bootstrapAdmin: phoneHmac === settings.bootstrapAdminPhoneHmac }));
      } catch (error) {
        if (error && error.code === 'CLOUD_MINIAPP_IDENTITY_REJECTED') throw error;
        throw rejected();
      }
      const result = publicIdentity(current);
      const issuedAt = currentNow();
      return Object.freeze({
        identity: result,
        token: issue(settings.ticketSecret, { v: 1, kind: 'miniapp-cloud', accountId: result.accountId, expiresAt: issuedAt.getTime() + 30 * 60 * 1000 }),
      });
    },
    async context(input) {
      const request = exact(input, ['token']);
      return currentContext(request.token);
    },
    async pendingAccounts(input) {
      const request = exact(input, ['token']);
      const actor = await currentContext(request.token);
      if (!actor.roles.includes('super_admin')) throw rejected();
      let rows;
      try {
        rows = await settings.accountRepository.listPending();
      } catch (_) {
        throw rejected();
      }
      if (!Array.isArray(rows)) throw rejected();
      return Object.freeze(rows.map(row => {
        const copy = exact(row, ['accountId', 'status', 'createdAt']);
        if (!text(copy.accountId) || copy.status !== 'pending_authorization' || typeof copy.createdAt !== 'string' || new Date(copy.createdAt).toISOString() !== copy.createdAt) throw rejected();
        return Object.freeze(copy);
      }));
    },
    async assignRole(input) {
      const request = exact(input, ['token', 'accountId', 'role']);
      const actor = await currentContext(request.token);
      const assignedRole = role(request.role);
      if (!actor.roles.includes('super_admin') || !text(request.accountId) || !assignedRole) throw rejected();
      let assigned;
      try {
        assigned = await settings.accountRepository.assignRole({ accountId: request.accountId, role: assignedRole });
      } catch (_) {
        throw rejected();
      }
      if (!assigned) throw rejected();
      return publicIdentity(identity(assigned));
    },
  });
}

module.exports = Object.freeze({ createMiniappCloudAccountService });
