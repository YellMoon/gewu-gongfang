'use strict';
const { scheduleActorParameters: actorParameters } = require('./businessScheduleActorScope');

function createBusinessCourseLifecycleMutations({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resultRow = async (sql, values) => {
    const result = await query(sql, values);
    return result?.rows?.length === 1 ? result.rows[0] : null;
  };
  const returnedCourse = 'SELECT id AS "id", to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt" FROM';
  const values = input => [input.tenantId, input.courseId, input.name, input.year, input.semester, input.displayName, input.type, input.sourceType, input.institutionId, input.priceTuition, input.priceTeacher, input.billingUnit, input.teacherFeeMode, input.roomId, input.roomName, input.teacherId, input.teacherName, input.active, input.defaultDurationMinutes, input.notes, JSON.stringify(input.pricings.map(pricing => ({ student_id: pricing.studentId, tuition: pricing.tuition, teacher_fee: pricing.teacherFee })))];
  return Object.freeze({
    create: input => resultRow(`${returnedCourse} business.vnext_create_scoped_course($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23)`, [...values(input), ...actorParameters(input.actorScope)]),
    update: input => typeof input.active === 'boolean' && Object.keys(input).every(key => ['tenantId','courseId','expectedUpdatedAt','active','actorScope'].includes(key))
      ? resultRow(`${returnedCourse} business.vnext_set_scoped_course_active($1,$2,$3::timestamptz,$4,$5,$6)`, [input.tenantId,input.courseId,input.expectedUpdatedAt,input.active,...actorParameters(input.actorScope)])
      : resultRow(`${returnedCourse} business.vnext_update_scoped_course($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24)`, [input.tenantId, input.courseId, input.expectedUpdatedAt, ...values(input).slice(2), ...actorParameters(input.actorScope)]),
    remove: input => resultRow(`${returnedCourse} business.vnext_delete_scoped_course($1,$2,$3::timestamptz,$4,$5)`, [input.tenantId, input.courseId, input.expectedUpdatedAt, ...actorParameters(input.actorScope)]),
  });
}

module.exports = Object.freeze({ createBusinessCourseLifecycleMutations });
