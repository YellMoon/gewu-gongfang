function scheduleDateInRange(schedule, dateRange) {
  if (!dateRange) return true;
  const [start, end] = dateRange;
  if (!start || !end) return true;

  const scheduleTime = new Date(schedule.start_time).getTime();
  const startTime = new Date(start).setHours(0, 0, 0, 0);
  const endTime = new Date(end).setHours(23, 59, 59, 999);

  return scheduleTime >= startTime && scheduleTime <= endTime;
}

function findScheduleCourse(schedule, courses) {
  return courses.find(item => String(item.id) === String(schedule.course_id));
}

function getScheduleStudentIds(schedule, course) {
  const courseStudentIds = (course?.student_pricings || []).map(item => item.student_id);
  const scheduleStudentIds = schedule.student_ids || [];
  return [...new Set([...courseStudentIds, ...scheduleStudentIds].filter(Boolean))];
}

function getScheduleYear(schedule, course) {
  return schedule.course_year ?? course?.year;
}

function getScheduleSemester(schedule, course) {
  return schedule.course_semester || course?.semester;
}

function getScheduleCourseName(schedule, course) {
  return schedule.course_name || course?.display_name || course?.name;
}

function scheduleMatchesFilters(schedule, courses, filters = {}) {
  const {
    filterTeacher,
    filterStudent,
    filterDateRange,
    filterYear,
    filterSemester,
    filterCourseName,
  } = filters;
  const course = findScheduleCourse(schedule, courses);

  if (filterTeacher && course?.teacher_id !== filterTeacher) {
    return false;
  }

  if (filterStudent && !getScheduleStudentIds(schedule, course).includes(filterStudent)) {
    return false;
  }

  if (filterYear !== undefined && filterYear !== null && String(getScheduleYear(schedule, course)) !== String(filterYear)) {
    return false;
  }

  if (filterSemester && getScheduleSemester(schedule, course) !== filterSemester) {
    return false;
  }

  if (filterCourseName && getScheduleCourseName(schedule, course) !== filterCourseName) {
    return false;
  }

  return scheduleDateInRange(schedule, filterDateRange);
}

export function applyScheduleListFilters(schedules = [], courses = [], filters = {}) {
  const result = schedules.filter(schedule => scheduleMatchesFilters(schedule, courses, filters));

  return result.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
}

function withoutFilter(filters, key) {
  const next = { ...filters };
  delete next[key];
  return next;
}

function uniqueOptions(values, labelResolver = value => value) {
  return [...new Set(values.filter(value => value !== undefined && value !== null && value !== ''))]
    .sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'))
    .map(value => ({ value, label: labelResolver(value) }));
}

function collectMatchingSchedules(schedules, courses, filters, excludedFilterKey) {
  return schedules.filter(schedule => scheduleMatchesFilters(schedule, courses, withoutFilter(filters, excludedFilterKey)));
}

export function buildScheduleListFilterOptions(
  schedules = [],
  courses = [],
  students = [],
  teachers = [],
  filters = {}
) {
  const teacherNameById = new Map(teachers.map(item => [item.id, item.name]));
  const studentNameById = new Map(students.map(item => [item.id, item.name]));

  const teacherSchedules = collectMatchingSchedules(schedules, courses, filters, 'filterTeacher');
  const studentSchedules = collectMatchingSchedules(schedules, courses, filters, 'filterStudent');
  const yearSchedules = collectMatchingSchedules(schedules, courses, filters, 'filterYear');
  const semesterSchedules = collectMatchingSchedules(schedules, courses, filters, 'filterSemester');
  const courseNameSchedules = collectMatchingSchedules(schedules, courses, filters, 'filterCourseName');

  const teachersOptions = uniqueOptions(
    teacherSchedules.map(schedule => findScheduleCourse(schedule, courses)?.teacher_id),
    value => teacherNameById.get(value) || value
  );

  const studentsOptions = uniqueOptions(
    studentSchedules.flatMap(schedule => getScheduleStudentIds(schedule, findScheduleCourse(schedule, courses))),
    value => studentNameById.get(value) || value
  );

  const yearsOptions = uniqueOptions(
    yearSchedules.map(schedule => getScheduleYear(schedule, findScheduleCourse(schedule, courses)))
  );

  const semestersOptions = uniqueOptions(
    semesterSchedules.map(schedule => getScheduleSemester(schedule, findScheduleCourse(schedule, courses)))
  );

  const coursesOptions = uniqueOptions(
    courseNameSchedules.map(schedule => getScheduleCourseName(schedule, findScheduleCourse(schedule, courses)))
  );

  return {
    teachers: teachersOptions,
    students: studentsOptions,
    years: yearsOptions,
    semesters: semestersOptions,
    courses: coursesOptions,
  };
}
