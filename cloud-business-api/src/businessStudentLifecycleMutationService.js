'use strict';
const { scheduleActorParameters } = require('./businessScheduleActorScope');

function createBusinessStudentLifecycleMutations({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resultRow = async (sql, values) => {
    const result = await query(sql, values);
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
  return Object.freeze({
    create: input => resultRow(
      `SELECT id AS "id", to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
       FROM business.vnext_create_scoped_student($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
      [input.tenantId, input.studentId, input.name, input.school, input.gradeYear, input.gradeCurrent, input.institutionId, input.parentName, input.notes, input.sourceType, input.studentSource, JSON.stringify(input.contacts), ...scheduleActorParameters(input.actorScope)],
    ),
    remove: input => resultRow(
      `SELECT id AS "id", to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
       FROM business.vnext_delete_scoped_student($1,$2,$3::timestamptz,$4,$5)`,
      [input.tenantId, input.studentId, input.expectedUpdatedAt, ...scheduleActorParameters(input.actorScope)],
    ),
  });
}

module.exports = Object.freeze({ createBusinessStudentLifecycleMutations });
