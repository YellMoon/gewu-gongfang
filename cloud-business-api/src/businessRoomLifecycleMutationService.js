'use strict';

function createBusinessRoomLifecycleMutations({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resultRow = async (sql, values) => {
    const result = await query(sql, values);
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
  const returnedRoom = 'SELECT id AS "id", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM';
  return Object.freeze({
    create: input => resultRow(`${returnedRoom} business.vnext_create_room_v1($1,$2,$3,$4)`, [input.tenantId, input.roomId, input.name, input.address]),
    update: input => resultRow(`${returnedRoom} business.vnext_update_room_v1($1,$2,$3::timestamptz,$4,$5)`, [input.tenantId, input.roomId, input.expectedUpdatedAt, input.name, input.address]),
    remove: input => resultRow(`${returnedRoom} business.vnext_soft_delete_room($1,$2,$3::timestamptz)`, [input.tenantId, input.roomId, input.expectedUpdatedAt]),
  });
}

module.exports = Object.freeze({ createBusinessRoomLifecycleMutations });
