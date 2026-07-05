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
  if (!nextDate || !Array.isArray(currentRange) || currentRange.length !== 2) return currentRange;

  const [currentStart, currentEnd] = currentRange;
  if (part === 'start') {
    return isAfter(nextDate, currentEnd) ? [nextDate, nextDate] : [nextDate, currentEnd];
  }

  if (part === 'end') {
    return isBefore(nextDate, currentStart) ? [nextDate, nextDate] : [currentStart, nextDate];
  }

  return currentRange;
}

function rowMatchesFilters(row, filters = {}, ignoreFacet) {
  if (ignoreFacet !== 'studentId' && filters.studentId && row.studentId !== filters.studentId) return false;
  if (ignoreFacet !== 'teacherId' && filters.teacherId && row.teacherId !== filters.teacherId) return false;
  if (ignoreFacet !== 'institutionId' && filters.institutionId && row.institutionId !== filters.institutionId) return false;
  if (ignoreFacet !== 'year' && filters.year && Number(row.courseYear) !== Number(filters.year)) return false;
  if (ignoreFacet !== 'semester' && filters.semester && row.semester !== filters.semester) return false;
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

export function buildRevenueFacetOptions(rows = [], students = [], teachers = [], institutions = [], filters = {}) {
  const optionRows = Object.fromEntries(FACETS.map(facet => [facet, optionRowsFor(rows, filters, facet)]));

  const studentNameById = new Map(students.map(student => [student.id, student.name]));
  const teacherNameById = new Map(teachers.map(teacher => [teacher.id, teacher.name]));
  const institutionNameById = new Map(institutions.map(institution => [institution.id, institution.name]));

  return {
    students: uniqueOptions(
      optionRows.studentId,
      row => row.studentId,
      row => studentNameById.get(row.studentId) || row.studentName || row.studentId
    ),
    teachers: uniqueOptions(
      optionRows.teacherId,
      row => row.teacherId,
      row => teacherNameById.get(row.teacherId) || row.teacherName || row.teacherId
    ),
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
    years: uniqueOptions(
      optionRows.year,
      row => Number(row.courseYear),
      (_row, value) => `${value}`
    ).sort((a, b) => Number(b.value) - Number(a.value)),
    semesters: uniqueOptions(
      optionRows.semester,
      row => row.semester,
      row => row.semester
    ),
    courseNames: uniqueOptions(
      optionRows.courseName,
      row => row.courseName,
      row => row.courseName
    ),
  };
}
