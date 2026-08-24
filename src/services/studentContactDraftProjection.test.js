'use strict';

const assert = require('assert');

(async () => {
  const {
    overlayStudentContactDraftProjection,
    studentContactFormValues,
  } = await import('./studentContactDraftProjection.mjs');

  const student = {
    id: 'student-1',
    phone: '13700000000',
    parent_wechat: 'legacy-guardian',
  };
  const contacts = [
    { id: 'contact-1', student_id: 'student-1', slot: 1, relationship: 'student', phone: '13800000000', wechat: 'old-student', status: 'active', updated_at: '2026-08-23T01:00:00.000Z' },
    { id: 'contact-2', student_id: 'student-1', slot: 2, relationship: 'guardian', phone: '13900000000', wechat: 'old-guardian', status: 'active', updated_at: '2026-08-23T02:00:00.000Z' },
    { id: 'other', student_id: 'student-2', slot: 1, relationship: 'student', phone: '13600000000', wechat: null, status: 'active', updated_at: '2026-08-23T03:00:00.000Z' },
  ];

  assert.deepStrictEqual(studentContactFormValues(student, contacts), {
    phone: '13800000000',
    student_wechat: 'old-student',
    parent_phone: '13900000000',
    parent_wechat: 'old-guardian',
    second_parent_phone: undefined,
    second_parent_wechat: undefined,
  }, 'structured contact rows must be authoritative over legacy student columns');

  const editedStudent = {
    ...student,
    phone: '13500000000',
    student_wechat: 'new-student',
    parent_phone: '',
    parent_wechat: '',
    second_parent_phone: '13400000000',
    second_parent_wechat: 'new-guardian-two',
  };
  const overlaid = overlayStudentContactDraftProjection(editedStudent, contacts);
  assert.deepStrictEqual(studentContactFormValues(editedStudent, overlaid), {
    phone: '13500000000',
    student_wechat: 'new-student',
    parent_phone: undefined,
    parent_wechat: undefined,
    second_parent_phone: '13400000000',
    second_parent_wechat: 'new-guardian-two',
  }, 'closing and reopening an offline edit must show the latest local contact draft');
  assert.strictEqual(overlaid.find(contact => contact.student_id === 'student-1' && contact.slot === 1).updated_at, '2026-08-23T01:00:00.000Z', 'local overlay must preserve the cloud conflict baseline');
  assert.strictEqual(overlaid.find(contact => contact.student_id === 'student-1' && contact.slot === 2).updated_at, '2026-08-23T02:00:00.000Z', 'cleared contacts must preserve the cloud conflict baseline');
  assert.strictEqual(overlaid.find(contact => contact.student_id === 'student-1' && contact.slot === 3).updated_at, null, 'new local contacts must keep a null cloud baseline');
  assert.strictEqual(overlaid.find(contact => contact.student_id === 'student-2').phone, '13600000000', 'other students must remain unchanged');

  console.log('student contact draft projection checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

