'use strict';

const assert = require('assert');
const { createBusinessStudentRecordUpdate } = require('./businessStudentRecordMutationService');

(async () => {
  const calls = [];
  const update = createBusinessStudentRecordUpdate({
    query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: [{ id: 'student-1', updatedAt: '2026-08-23T02:00:00.000Z' }] };
    },
  });
  const contacts = [
    { slot: 1, relationship: 'student', phone: '13800138000', wechat: null, expectedUpdatedAt: '2026-08-22T00:00:00.000Z' },
    { slot: 2, relationship: 'guardian', phone: null, wechat: null, expectedUpdatedAt: '2026-08-22T00:00:00.000Z' },
  ];
  assert.deepStrictEqual(await update({
    actorScope: { role: 'super_admin', teacherId: null },
    tenantId: 'default', studentId: 'student-1', expectedUpdatedAt: '2026-08-22T00:00:00.000Z',
    name: 'Student', school: null, gradeYear: null, gradeCurrent: null, institutionId: null,
    parentName: null, notes: null, sourceType: 1, studentSource: 'Referral', contacts,
  }), { id: 'student-1', updatedAt: '2026-08-23T02:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_update_scoped_student_record/);
  assert.strictEqual(calls[0][1].at(-3), JSON.stringify([
    { slot: 1, relationship: 'student', phone: '13800138000', wechat: null, expected_updated_at: '2026-08-22T00:00:00.000Z' },
    { slot: 2, relationship: 'guardian', phone: null, wechat: null, expected_updated_at: '2026-08-22T00:00:00.000Z' },
  ]));
  await assert.rejects(() => update({ contacts: [] }), e => e.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
  assert.equal(calls.length, 1);
  console.log('business student record mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
