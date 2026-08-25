'use strict';

const crypto = require('crypto');

function failure(code) {
  return Object.assign(new Error('desktop teacher registration failed'), { code });
}

function text(value, maximum) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum ? value : null;
}

function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure(code);
  return value;
}

function stableTeacherId(accountId) {
  return `teacher-${crypto.createHash('sha256').update(accountId, 'utf8').digest('hex').slice(0, 32)}`;
}

function createDesktopTeacherSelfRegistrationService({ tenantId, inspectVerificationToken, registerTeacher }) {
  if (!text(tenantId, 512) || typeof inspectVerificationToken !== 'function' || typeof registerTeacher !== 'function') throw failure('CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID');
  return Object.freeze({
    async register(input) {
      const request = exact(input, ['verificationToken', 'name', 'subject'], 'CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID');
      const verificationToken = text(request.verificationToken, 4096);
      const name = text(request.name, 128);
      const subject = request.subject === null ? null : text(request.subject, 128);
      if (!verificationToken || !name || (request.subject !== null && !subject)) throw failure('CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID');
      let ticket;
      try {
        ticket = inspectVerificationToken(verificationToken);
      } catch (_) {
        throw failure('CLOUD_DESKTOP_TEACHER_REGISTRATION_REJECTED');
      }
      if (!ticket || !text(ticket.authorityId, 512) || !text(ticket.accountId, 512) || !/^[0-9a-f]{64}$/u.test(ticket.phoneHmac || '')) {
        throw failure('CLOUD_DESKTOP_TEACHER_REGISTRATION_REJECTED');
      }
      const teacherId = stableTeacherId(ticket.accountId);
      let registered;
      try {
        registered = await registerTeacher({ tenantId, authorityId: ticket.authorityId, accountId: ticket.accountId, phoneHmac: ticket.phoneHmac, teacherId, name, subject });
      } catch (_) {
        throw failure('CLOUD_DESKTOP_TEACHER_REGISTRATION_REJECTED');
      }
      if (!registered || registered.teacherId !== teacherId || typeof registered.updatedAt !== 'string' || !Number.isFinite(Date.parse(registered.updatedAt)) || typeof registered.replayed !== 'boolean') {
        throw failure('CLOUD_DESKTOP_TEACHER_REGISTRATION_REJECTED');
      }
      return Object.freeze({ teacherId, updatedAt: registered.updatedAt, replayed: registered.replayed });
    },
  });
}

module.exports = Object.freeze({ createDesktopTeacherSelfRegistrationService, stableTeacherId });
