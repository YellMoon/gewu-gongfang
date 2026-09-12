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
    actorScope: { role: 'teacher', teacherId: 'creator' },
  };
  assert.deepStrictEqual(await mutations.create(input), { id: 'teacher-new', updatedAt: '2026-08-23T04:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_scoped_teacher/);
  assert.deepStrictEqual(calls[0][1].slice(-2), ['teacher','creator']);
  assert.deepStrictEqual(await mutations.update({ ...input, expectedUpdatedAt: '2026-08-23T04:00:00.000Z' }), { id: 'teacher-new', updatedAt: '2026-08-23T04:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_update_scoped_teacher/);
  assert.deepStrictEqual(calls[1][1].slice(-2), ['teacher','creator']);
  assert.deepStrictEqual(await mutations.remove({ tenantId: 'default', teacherId: 'teacher-new', expectedUpdatedAt: '2026-08-23T04:00:00.000Z', actorScope: input.actorScope }), { id: 'teacher-new', updatedAt: '2026-08-23T04:00:00.000Z' });
  assert.match(calls[2][0], /business\.vnext_delete_scoped_teacher/);
  assert.deepStrictEqual(calls[2][1].slice(-2), ['teacher','creator']);
  for (const actorScope of [undefined, { role: 'super_admin', teacherId: 'creator' }, { role: 'teacher', teacherId: '' }, { role: 'student', teacherId: 'creator' }]) {
    for (const method of ['create', 'update', 'remove']) assert.throws(() => mutations[method]({ ...input, actorScope }), error => error.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
  }
  assert.strictEqual(calls.length, 3, 'invalid scope must not send SQL');
  console.log('business teacher lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
