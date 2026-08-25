'use strict';

const assert = require('assert');
const { createDesktopTeacherSelfRegistrationService } = require('./desktopTeacherSelfRegistrationService');

const calls = [];
const service = createDesktopTeacherSelfRegistrationService({
  tenantId: 'default',
  inspectVerificationToken: token => {
    if (token !== 'verified-ticket') throw Object.assign(new Error('rejected'), { code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
    return { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) };
  },
  registerTeacher: async input => {
    calls.push(input);
    return { teacherId: input.teacherId, updatedAt: '2026-08-26T08:00:00.000Z', replayed: false };
  },
});

(async () => {
  const created = await service.register({ verificationToken: 'verified-ticket', name: 'Teacher One', subject: 'physics' });
  assert.deepStrictEqual(created, {
    teacherId: 'teacher-07e998012c1137decdf3efbbb1c3ee6d',
    updatedAt: '2026-08-26T08:00:00.000Z',
    replayed: false,
  });
  assert.deepStrictEqual(calls, [{
    tenantId: 'default', authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64),
    teacherId: 'teacher-07e998012c1137decdf3efbbb1c3ee6d', name: 'Teacher One', subject: 'physics',
  }]);
  await assert.rejects(() => service.register({ verificationToken: 'verified-ticket', name: '', subject: null }), error => error.code === 'CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID');
  await assert.rejects(() => service.register({ verificationToken: 'verified-ticket', name: 'Teacher One', subject: 'x'.repeat(129) }), error => error.code === 'CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID');
  await assert.rejects(() => service.register({ verificationToken: 'other-ticket', name: 'Teacher One', subject: null }), error => error.code === 'CLOUD_DESKTOP_TEACHER_REGISTRATION_REJECTED');
  console.log('desktop teacher self-registration service checks passed');
})();
