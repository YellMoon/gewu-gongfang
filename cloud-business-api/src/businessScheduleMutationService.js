'use strict';

function createBusinessScheduleUpdate({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  return async function updateSchedule(input) {
    const result = await query(
      `SELECT id AS "id", to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
       FROM business.vnext_update_schedule_record_v2($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        input.tenantId, input.scheduleId, input.expectedUpdatedAt, input.startAt, input.endAt,
        input.status, input.roomDisplay, input.tuition, input.teacherFee, input.notes,
        Array.isArray(input.pricings) ? JSON.stringify(input.pricings.map(pricing => ({
          student_id: pricing.studentId,
          attendance_status: pricing.attendanceStatus,
          tuition: pricing.tuition,
          teacher_fee: pricing.teacherFee,
        }))) : null,
      ],
    );
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
}

module.exports = Object.freeze({ createBusinessScheduleUpdate });
