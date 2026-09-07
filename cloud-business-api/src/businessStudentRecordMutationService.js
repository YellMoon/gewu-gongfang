'use strict';
const { scheduleActorParameters } = require('./businessScheduleActorScope');

function createBusinessStudentRecordUpdate({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  return async function updateStudentRecord(input) {
    const contacts = input.contacts.map(({ expectedUpdatedAt, ...contact }) => ({
      ...contact,
      expected_updated_at: expectedUpdatedAt,
    }));
    const result = await query(
      `SELECT id AS "id", to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
       FROM business.vnext_update_scoped_student_record($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
      [
        input.tenantId, input.studentId, input.expectedUpdatedAt, input.name, input.school,
        input.gradeYear, input.gradeCurrent, input.institutionId, input.parentName, input.notes,
        input.sourceType, input.studentSource, JSON.stringify(contacts), ...scheduleActorParameters(input.actorScope),
      ],
    );
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
}

module.exports = Object.freeze({ createBusinessStudentRecordUpdate });
