import dayjs from 'dayjs';
import { revenueInstitutionId } from './revenueDetailFilters.mjs';

const COURSE_TYPE_LABELS = {
  1: '一对一',
  2: '一对二',
  3: '小组课',
  4: '大班课',
};

const FACETS = [
  'studentId',
  'teacherId',
  'courseTypes',
  'institutionId',
  'year',
  'semester',
  'courseId',
  'courseName',
];

function isAfter(left, right) {
  if (!left || !right) return false;
  if (typeof left.isAfter === 'function') return left.isAfter(right, 'day');
  return left.valueOf() > right.valueOf();
}

function isBefore(left, right) {
  if (!left || !right) return false;
  if (typeof left.isBefore === 'function') return left.isBefore(right, 'day');
  return left.valueOf() < right.valueOf();
}

export function applyRevenueDateChange(currentRange, part, nextDate) {
  if (!Array.isArray(currentRange) || currentRange.length !== 2) return currentRange;

  const [currentStart, currentEnd] = currentRange;
  if (part === 'start') {
    if (!nextDate) return [null, currentEnd || null];
    return isAfter(nextDate, currentEnd) ? [nextDate, nextDate] : [nextDate, currentEnd || null];
  }

  if (part === 'end') {
    if (!nextDate) return [currentStart || null, null];
    return isBefore(nextDate, currentStart) ? [nextDate, nextDate] : [currentStart || null, nextDate];
  }

  return currentRange;
}

export function clearRevenueDateRange() {
  return [null, null];
}

function formatDateBoundary(date) {
  if (!date) return undefined;
  if (typeof date.format === 'function') return date.format('YYYY-MM-DD');
  return String(date).slice(0, 10);
}

export function isDateWithinRevenueRange(dateStr, dateRange = []) {
  const startDate = formatDateBoundary(dateRange[0]);
  const endDate = formatDateBoundary(dateRange[1]);
  const comparableDate = String(dateStr || '').slice(0, 10);

  if (!comparableDate) return false;
  if (startDate && comparableDate < startDate) return false;
  if (endDate && comparableDate > endDate) return false;
  return true;
}

export function filterRevenueSchedules(schedules = [], courses = [], filters = {}, options = {}) {
  const courseMap = new Map(courses.map(course => [course.id, course]));
  const excludedStatuses = new Set(options.excludedStatuses || []);
  const selectedTypes = Array.isArray(filters.courseTypes) ? filters.courseTypes.map(Number) : [];

  return schedules.filter(schedule => {
    const start = schedule.start_time ? dayjs(schedule.start_time) : null;
    const dateStr = start?.isValid() ? start.format('YYYY-MM-DD') : '';
    if (filters.dateRange && !isDateWithinRevenueRange(dateStr, filters.dateRange)) return false;
    if (excludedStatuses.has(schedule.status)) return false;

    const course = courseMap.get(schedule.course_id);
    const courseType = Number(course?.type || schedule.course_type || 1);
    const courseName = course?.display_name || schedule.course_name || course?.name || '';
    if (selectedTypes.length > 0 && !selectedTypes.includes(courseType)) return false;
    if (filters.year && Number(course?.year) !== Number(filters.year)) return false;
    if (filters.semester && course?.semester !== filters.semester) return false;
    if (filters.courseId && schedule.course_id !== filters.courseId) return false;
    if (filters.courseName && courseName !== filters.courseName) return false;
    return true;
  });
}

function rowMatchesFilters(row, filters = {}, ignoreFacet) {
  if (filters.dateRange && !isDateWithinRevenueRange(row.date || row.startTime, filters.dateRange)) return false;
  if (ignoreFacet !== 'studentId' && filters.studentId && row.studentId !== filters.studentId) return false;
  if (ignoreFacet !== 'teacherId' && filters.teacherId && row.teacherId !== filters.teacherId) return false;
  if (ignoreFacet !== 'institutionId' && filters.institutionId && row.institutionId !== filters.institutionId) return false;
  if (ignoreFacet !== 'year' && filters.year && Number(row.courseYear) !== Number(filters.year)) return false;
  if (ignoreFacet !== 'semester' && filters.semester && row.semester !== filters.semester) return false;
  if (ignoreFacet !== 'courseId' && filters.courseId && row.courseId !== filters.courseId) return false;
  if (ignoreFacet !== 'courseName' && filters.courseName && row.courseName !== filters.courseName) return false;
  if (
    ignoreFacet !== 'courseTypes' &&
    Array.isArray(filters.courseTypes) &&
    filters.courseTypes.length > 0 &&
    !filters.courseTypes.map(Number).includes(Number(row.courseType))
  ) {
    return false;
  }
  return true;
}

function uniqueOptions(rows, getValue, getLabel) {
  const map = new Map();
  rows.forEach(row => {
    const value = getValue(row);
    if (value === undefined || value === null || value === '') return;
    if (!map.has(value)) {
      map.set(value, {
        value,
        label: getLabel(row, value),
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-CN'));
}

function optionRowsFor(rows, filters, facet) {
  return rows.filter(row => rowMatchesFilters(row, filters, facet));
}

function courseDisplayName(course = {}) {
  return String(course.display_name || course.name || '').trim();
}

function courseStudentIds(course = {}) {
  const ids = [
    ...(Array.isArray(course.student_ids) ? course.student_ids : []),
    ...(Array.isArray(course.student_pricings) ? course.student_pricings.map(item => item && item.student_id) : []),
  ];
  return new Set(ids.filter(Boolean).map(String));
}

function courseStudentNames(course = {}, studentNameById = new Map()) {
  return Array.from(courseStudentIds(course))
    .map(id => studentNameById.get(id) || id)
    .filter(Boolean);
}

function courseOptionLabel(course = {}, teacherNameById = new Map(), studentNameById = new Map()) {
  const parts = [
    courseDisplayName(course),
    course.year,
    course.semester,
    teacherNameById.get(course.teacher_id) || course.teacher_name,
    ...courseStudentNames(course, studentNameById),
  ];
  return parts.filter(item => item !== undefined && item !== null && String(item).trim() !== '').join(' · ');
}

export function buildCourseCatalogOptionSources(courses = []) {
  const map = new Map();
  courses.forEach(course => {
    const name = courseDisplayName(course);
    if (!name) return;
    const key = course.id || name;
    if (map.has(key)) return;
    map.set(key, {
      ...course,
      id: key,
      name,
      display_name: name,
    });
  });
  return Array.from(map.values()).sort((a, b) => courseOptionLabel(a).localeCompare(courseOptionLabel(b), 'zh-CN'));
}

export function buildRevenueFacetOptions(rows = [], students = [], teachers = [], institutions = [], filters = {}, courses = []) {
  const facetRows = rows.map(row => ({...row, institutionId: revenueInstitutionId(row, students)}));
  const optionRows = Object.fromEntries(FACETS.map(facet => [facet, optionRowsFor(facetRows, filters, facet)]));

  const studentNameById = new Map(students.map(student => [student.id, student.name]));
  const teacherNameById = new Map(teachers.map(teacher => [teacher.id, teacher.name]));
  const institutionNameById = new Map(institutions.map(institution => [institution.id, institution.name]));

  const teacherOptions = uniqueOptions(optionRows.teacherId, row => row.teacherId, row => teacherNameById.get(row.teacherId) || row.teacherName || row.teacherId);
  const yearOptions = uniqueOptions(optionRows.year, row => Number.isFinite(Number(row.courseYear)) && row.courseYear ? Number(row.courseYear) : undefined, (_row, value) => `${value}`)
    .sort((a, b) => Number(b.value) - Number(a.value));
  const semesterOptions = uniqueOptions(optionRows.semester, row => row.semester, row => row.semester);

  return {
    students: uniqueOptions(
      optionRows.studentId,
      row => row.studentId,
      row => studentNameById.get(row.studentId) || row.studentName || row.studentId
    ),
    teachers: teacherOptions,
    courseTypes: uniqueOptions(
      optionRows.courseTypes,
      row => Number(row.courseType),
      row => row.courseTypeName || COURSE_TYPE_LABELS[Number(row.courseType)] || row.courseType
    ),
    institutions: uniqueOptions(
      optionRows.institutionId,
      row => row.institutionId,
      row => institutionNameById.get(row.institutionId) || row.institutionName || row.institutionId
    ),
    years: yearOptions,
    semesters: semesterOptions,
    courseNames: uniqueOptions(optionRows.courseId.filter(row => row.courseId), row => row.courseId, row => {
      const course = courses.find(course => course.id === row.courseId);
      return course ? courseOptionLabel(course, teacherNameById, studentNameById) : row.courseName || row.courseId;
    }),
  };
}
