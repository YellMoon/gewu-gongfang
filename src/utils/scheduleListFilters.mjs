function scheduleDateInRange(schedule, dateRange) {
  if (!dateRange) return true;
  const [start, end] = dateRange;
  if (!start || !end) return true;

  const scheduleTime = new Date(schedule.start_time).getTime();
  const startTime = new Date(start).setHours(0, 0, 0, 0);
  const endTime = new Date(end).setHours(23, 59, 59, 999);

  return scheduleTime >= startTime && scheduleTime <= endTime;
}

export function applyScheduleListFilters(schedules = [], courses = [], filters = {}) {
  const { filterTeacher, filterStudent, filterDateRange } = filters;

  const result = schedules.filter(schedule => {
    const course = courses.find(item => String(item.id) === String(schedule.course_id));

    if (filterTeacher && course?.teacher_id !== filterTeacher) {
      return false;
    }

    if (filterStudent) {
      const courseStudentIds = (course?.student_pricings || []).map(item => item.student_id);
      const scheduleStudentIds = schedule.student_ids || [];
      if (!courseStudentIds.includes(filterStudent) && !scheduleStudentIds.includes(filterStudent)) {
        return false;
      }
    }

    return scheduleDateInRange(schedule, filterDateRange);
  });

  return result.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
}
