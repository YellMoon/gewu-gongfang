function invalid() {
  const error = new Error('CLOUD_SCHEDULE_PROJECTION_INVALID');
  error.code = 'CLOUD_SCHEDULE_PROJECTION_INVALID';
  return error;
}

function text(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw invalid();
  return normalized;
}

function instant(value) {
  const normalized = String(value || '').trim();
  if (!normalized || !Number.isFinite(Date.parse(normalized))) throw invalid();
  return normalized;
}

export function projectCloudSchedules(rows) {
  if (!Array.isArray(rows)) throw invalid();
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid();
    return {
      id: text(row.id),
      course_id: text(row.courseId),
      course_name: text(row.courseName),
      start_time: instant(row.startAt),
      end_time: instant(row.endAt),
      updated_at: instant(row.updatedAt),
      status: Number(row.status),
      room: row.roomDisplay == null ? '' : String(row.roomDisplay),
      calculated_tuition: row.tuition == null ? '0' : String(row.tuition),
      calculated_teacher_fee: row.teacherFee == null ? '0' : String(row.teacherFee),
    };
  });
}

// Editing requires the complete, single-snapshot cloud projection. A summary
// row cannot supply empty defaults for existing attendance, fees or recurrence.
export function projectCloudScheduleRecords(projection) {
  if (!Array.isArray(projection?.schedules) || !Array.isArray(projection?.courses)) throw invalid();
  const courses = new Map(projection.courses.map(course => [course.id, course]));
  return projection.schedules.map(row => {
    if (!row || !Array.isArray(row.student_pricings)
      || !Object.hasOwn(row, 'recurring_rule') || !Object.hasOwn(row, 'service_type')) throw invalid();
    const course = courses.get(row.course_id);
    return {
      ...row,
      id: text(row.id), course_id: text(row.course_id),
      start_time: instant(row.start_time), end_time: instant(row.end_time), updated_at: instant(row.updated_at),
      course_name: String(course?.display_name || course?.name || row.course_name || row.course_id),
      student_pricings: row.student_pricings.map(pricing => ({ ...pricing })),
    };
  });
}
