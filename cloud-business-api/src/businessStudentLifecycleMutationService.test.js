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
    actorScope: { role: 'super_admin', teacherId: null },
    tenantId: 'default', studentId: 'student-new', name: 'New student', school: null, gradeYear: null,
    gradeCurrent: null, institutionId: null, parentName: null, notes: null, sourceType: 1, studentSource: null, contacts,
  }), { id: 'student-new', updatedAt: '2026-08-23T03:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_scoped_student/);
  assert.strictEqual(calls[0][1].at(-3), JSON.stringify(contacts));
  assert.deepStrictEqual(await mutations.remove({ actorScope: { role: 'super_admin', teacherId: null }, tenantId: 'default', studentId: 'student-new', expectedUpdatedAt: '2026-08-23T03:00:00.000Z' }), { id: 'student-new', updatedAt: '2026-08-23T03:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_delete_scoped_student/);
  assert.throws(() => mutations.create({ contacts: [] }), e => e.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
  assert.throws(() => mutations.remove({}), e => e.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
  assert.equal(calls.length, 2);
  // UTF-8: an existing identifier is a conflict, not an outage or a successful retry.
  for (const code of ['23505', '42501', '08006']) {
    const failure = Object.assign(new Error('synthetic database failure'), { code });
    const failed = createBusinessStudentLifecycleMutations({ query: async () => { throw failure; } });
    const input = { actorScope: { role: 'super_admin', teacherId: null }, contacts: [] };
    if (code === '23505') assert.equal(await failed.create(input), null);
    else await assert.rejects(() => failed.create(input), error => error === failure);
    await assert.rejects(() => failed.remove(input), error => error === failure);
  }
  console.log('business student lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
