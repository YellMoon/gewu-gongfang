'use strict';

function createBusinessScheduleLifecycleMutations({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resultRow = async (sql, values) => {
    const result = await query(sql, values);
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
  const returnedSchedule = 'SELECT id AS "id", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM';
  return Object.freeze({
    create: input => resultRow(
      `${returnedSchedule} business.vnext_create_schedule_record_v1($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        input.tenantId, input.scheduleId, input.courseId, input.startAt, input.endAt, input.recurringRule,
        input.status, input.roomDisplay, input.serviceType, input.tuition, input.teacherFee, input.notes,
        JSON.stringify(input.pricings.map(pricing => ({
          student_id: pricing.studentId,
          attendance_status: pricing.attendanceStatus,
          tuition: pricing.tuition,
          teacher_fee: pricing.teacherFee,
        }))),
      ],
    ),
    remove: input => resultRow(
      `${returnedSchedule} business.vnext_soft_delete_schedule($1,$2,$3::timestamptz)`,
      [input.tenantId, input.scheduleId, input.expectedUpdatedAt],
    ),
  });
}

module.exports = Object.freeze({ createBusinessScheduleLifecycleMutations });
