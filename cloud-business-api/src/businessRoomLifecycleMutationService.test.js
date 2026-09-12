'use strict';

const assert = require('assert');
const { createBusinessRoomLifecycleMutations } = require('./businessRoomLifecycleMutationService');
require('../sql/room-lifecycle.postgres.test');

(async () => {
  const calls = [];
  const mutations = createBusinessRoomLifecycleMutations({
    query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: [{ id: values[1], updatedAt: '2026-08-23T05:00:00.000Z' }] };
    },
  });
  const input = { actorScope: { role: 'teacher', teacherId: 'teacher-1' }, tenantId: 'default', roomId: 'room-new', name: 'Room new', address: 'Address new' };
  assert.deepStrictEqual(await mutations.create(input), { id: 'room-new', updatedAt: '2026-08-23T05:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_scoped_room/);
  assert.deepStrictEqual(calls[0][1].slice(-2), ['teacher', 'teacher-1']);
  assert.throws(() => mutations.create({ ...input, actorScope: undefined }), error => error.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
  assert.deepStrictEqual(await mutations.update({ ...input, expectedUpdatedAt: '2026-08-23T05:00:00.000Z' }), { id: 'room-new', updatedAt: '2026-08-23T05:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_update_scoped_room/);
  assert.deepStrictEqual(await mutations.remove({ ...input, expectedUpdatedAt: '2026-08-23T05:00:00.000Z' }), { id: 'room-new', updatedAt: '2026-08-23T05:00:00.000Z' });
  assert.match(calls[2][0], /business\.vnext_delete_scoped_room/);
  for (const [,values] of calls) assert.deepStrictEqual(values.slice(-2), ['teacher', 'teacher-1']);
  for (const method of ['update', 'remove']) assert.throws(() => mutations[method]({ ...input, actorScope: undefined }), error => error.code === 'CLOUD_BUSINESS_ACCESS_DENIED');
  console.log('business room lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
