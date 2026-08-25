'use strict';

const assert = require('assert');
const { createDesktopTeacherSelfRegistrationRepository } = require('./desktopTeacherSelfRegistrationRepository');

const calls = [];
const repository = createDesktopTeacherSelfRegistrationRepository({
  query: async (sql, values) => {
    calls.push([sql, values]);
    return { rows: [{ teacherId: 'teacher-1', updatedAt: new Date('2026-08-26T08:00:00.000Z') }] };
  },
});

(async () => {
  const result = await repository.registerTeacher({
    tenantId: 'default', authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64),
    teacherId: 'teacher-1', name: 'Teacher One', subject: null,
  });
  assert.deepStrictEqual(result, { teacherId: 'teacher-1', updatedAt: '2026-08-26T08:00:00.000Z', replayed: false });
  assert.ok(calls[0][0].includes('business.vnext_self_register_teacher_v1'));
  assert.deepStrictEqual(calls[0][1], ['default', 'account-1', 'a'.repeat(64), 'teacher-1', 'Teacher One', null]);
  console.log('desktop teacher self-registration repository checks passed');
})();
