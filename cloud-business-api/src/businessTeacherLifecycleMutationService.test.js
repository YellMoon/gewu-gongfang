'use strict';

const assert = require('assert');
const { createBusinessTeacherLifecycleMutations } = require('./businessTeacherLifecycleMutationService');

(async () => {
  const calls = [];
  const mutations = createBusinessTeacherLifecycleMutations({
    query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: [{ id: values[1], updatedAt: '2026-08-23T04:00:00.000Z' }] };
    },
  });
  const input = {
    tenantId: 'default', teacherId: 'teacher-new', name: 'New teacher', phone: '13800138000',
    subject: 'math', hourlyRate: 100, notes: null,
  };
  assert.deepStrictEqual(await mutations.create(input), { id: 'teacher-new', updatedAt: '2026-08-23T04:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_teacher_v1/);
  assert.deepStrictEqual(await mutations.update({ ...input, expectedUpdatedAt: '2026-08-23T04:00:00.000Z' }), { id: 'teacher-new', updatedAt: '2026-08-23T04:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_update_teacher_v1/);
  assert.deepStrictEqual(await mutations.remove({ tenantId: 'default', teacherId: 'teacher-new', expectedUpdatedAt: '2026-08-23T04:00:00.000Z' }), { id: 'teacher-new', updatedAt: '2026-08-23T04:00:00.000Z' });
  assert.match(calls[2][0], /business\.vnext_soft_delete_teacher/);
  console.log('business teacher lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
