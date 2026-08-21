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
