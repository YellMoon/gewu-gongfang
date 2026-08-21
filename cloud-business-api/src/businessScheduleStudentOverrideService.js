'use strict';

function createBusinessScheduleStudentOverride({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  return async function updateScheduleStudentOverride({
    tenantId, scheduleId, studentId, expectedUpdatedAt, attendanceStatus, tuition, teacherFee,
  } = {}) {
    const result = await query(
      `SELECT id AS "id", to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
       FROM business.vnext_upsert_schedule_student_override($1,$2,$3,$4::timestamptz,$5,$6,$7)`,
      [tenantId, scheduleId, studentId, expectedUpdatedAt, attendanceStatus, tuition, teacherFee],
    );
    return result?.rows?.[0] || null;
  };
}

module.exports = { createBusinessScheduleStudentOverride };
