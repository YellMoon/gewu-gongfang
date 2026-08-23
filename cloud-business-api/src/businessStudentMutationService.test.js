'use strict';
const assert = require('assert');
const { createBusinessStudentUpdate } = require('./businessStudentMutationService');
(async () => {
  const calls = [];
  const update = createBusinessStudentUpdate({ query: async (sql, values) => { calls.push([sql, values]); return { rows: [{ id: 'student-1', updatedAt: '2026-08-23T01:00:00.000Z' }] }; } });
  assert.deepStrictEqual(await update({ tenantId: 'default', studentId: 'student-1', expectedUpdatedAt: '2026-08-22T00:00:00.000Z', name: 'Student', school: null, gradeYear: null, gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1, studentSource: 'Referral' }), { id: 'student-1', updatedAt: '2026-08-23T01:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_update_student_v2/);
  assert.deepStrictEqual(calls[0][1].slice(-2), [1, 'Referral']);
  console.log('business student mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
