'use strict';

const assert = require('assert');
const { createBusinessRoomLifecycleMutations } = require('./businessRoomLifecycleMutationService');

(async () => {
  const calls = [];
  const mutations = createBusinessRoomLifecycleMutations({
    query: async (sql, values) => {
      calls.push([sql, values]);
      return { rows: [{ id: values[1], updatedAt: '2026-08-23T05:00:00.000Z' }] };
    },
  });
  const input = { tenantId: 'default', roomId: 'room-new', name: 'Room new', address: 'Address new' };
  assert.deepStrictEqual(await mutations.create(input), { id: 'room-new', updatedAt: '2026-08-23T05:00:00.000Z' });
  assert.match(calls[0][0], /business\.vnext_create_room_v1/);
  assert.deepStrictEqual(await mutations.update({ ...input, expectedUpdatedAt: '2026-08-23T05:00:00.000Z' }), { id: 'room-new', updatedAt: '2026-08-23T05:00:00.000Z' });
  assert.match(calls[1][0], /business\.vnext_update_room_v1/);
  assert.deepStrictEqual(await mutations.remove({ tenantId: 'default', roomId: 'room-new', expectedUpdatedAt: '2026-08-23T05:00:00.000Z' }), { id: 'room-new', updatedAt: '2026-08-23T05:00:00.000Z' });
  assert.match(calls[2][0], /business\.vnext_soft_delete_room/);
  console.log('business room lifecycle mutation service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
