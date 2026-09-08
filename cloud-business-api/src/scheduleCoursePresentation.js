'use strict';

// UTF-8: retain the original course-derived labels for already-authorized lessons.
// Tombstoned courses remain outside selectors. No rates, contacts or new lessons are exposed.
function withScheduleCourseContextSql(sql) {
  return [
    `WITH course_context_projection AS (${sql})`,
    'SELECT projection || jsonb_build_object(',
    "'_scheduleCourseContext',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'display_name',c.display_name,'type',c.course_type,'year',c.year,'semester',c.semester) ORDER BY c.id) FROM business.courses c WHERE c.tenant_id=$1 AND c.id IN (SELECT lesson->>'course_id' FROM jsonb_array_elements(projection->'schedules') lesson)),'[]'::jsonb)",
    ') AS projection FROM course_context_projection',
  ].join(' ');
}

function applyScheduleCourseContext(value) {
  if (!value || !Array.isArray(value.schedules)) return value;
  const { _scheduleCourseContext: context, ...projection } = value;
  const courses = new Map((Array.isArray(context) ? context : []).map(course => [course.id, course]));
  return { ...projection, schedules: value.schedules.map(schedule => {
    const course = courses.get(schedule.course_id);
    if (!course) return schedule;
    // Same display_name / plain name precedence and whitespace rules as the original desktop.
    const name = String(course.display_name || '').trim()
      || String(course.name || '').replace(/^\d{4}\s+\S+学期\s+/, '').trim()
      || String(schedule.course_name || '').trim();
    return { ...schedule, course_name: name, course_type: course.type,
      course_year: course.year === null || course.year === undefined ? undefined : String(course.year),
      course_semester: course.semester || undefined };
  }) };
}

module.exports = { withScheduleCourseContextSql, applyScheduleCourseContext };
