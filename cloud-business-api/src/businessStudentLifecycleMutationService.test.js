'use strict';

const assert = require('assert');
const { createBusinessStudentLifecycleMutations } = require('./businessStudentLifecycleMutationService');

(async () => {
  const calls = [];
  const mutations = createBusinessStudentLifecycleMutations({
    query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: [{ id: values[1], updatedAt: '2026-08-23T03:00:00.000Z' }] };
    },
  });
  const contacts = [{ slot: 1, relationship: 'student', phone: '13800138000', wechat: null }];
  assert.deepStrictEqual(await mutations.create({
    tenantId: 'default', studentId: 'student-new', name: 'New student', school: null, gradeYear: null,
    gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1, studentSource: null, contacts,
  }), { id: 'student-new', updatedAt: '2026-08-23T03:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_student_record_v1/);
  assert.strictEqual(calls[0][1].at(-1), JSON.stringify(contacts));
  assert.deepStrictEqual(await mutations.remove({ tenantId: 'default', studentId: 'student-new', expectedUpdatedAt: '2026-08-23T03:00:00.000Z' }), { id: 'student-new', updatedAt: '2026-08-23T03:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_soft_delete_student/);
  console.log('business student lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
