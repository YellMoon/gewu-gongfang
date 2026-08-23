'use strict';

function createBusinessTeacherLifecycleMutations({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resultRow = async (sql, values) => {
    const result = await query(sql, values);
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
  const returnedTeacher = 'SELECT id AS "id", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM';
  return Object.freeze({
    create: input => resultRow(
      `${returnedTeacher} business.vnext_create_teacher_v1($1,$2,$3,$4,$5,$6,$7)`,
      [input.tenantId, input.teacherId, input.name, input.phone, input.subject, input.hourlyRate, input.notes],
    ),
    update: input => resultRow(
      `${returnedTeacher} business.vnext_update_teacher_v1($1,$2,$3::timestamptz,$4,$5,$6,$7,$8)`,
      [input.tenantId, input.teacherId, input.expectedUpdatedAt, input.name, input.phone, input.subject, input.hourlyRate, input.notes],
    ),
    remove: input => resultRow(
      `${returnedTeacher} business.vnext_soft_delete_teacher($1,$2,$3::timestamptz)`,
      [input.tenantId, input.teacherId, input.expectedUpdatedAt],
    ),
  });
}

module.exports = Object.freeze({ createBusinessTeacherLifecycleMutations });
