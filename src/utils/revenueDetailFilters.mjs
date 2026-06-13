const STUDENT_SOURCE_INSTITUTION = 2;
const COURSE_TYPE_ONE_ON_ONE = 1;
const COURSE_SOURCE_INSTITUTION = 2;
const COURSE_SOURCE_MIXED = 3;
const INSTITUTION_UNBOUND_STUDENT_ID = '__institution_unbound__';
const UNBOUND_STUDENT_ID = '__unbound__';

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function courseIsInstitutionOwned(row, institutionId) {
  return Number(row.sourceType) === COURSE_SOURCE_INSTITUTION && row.institutionId === institutionId;
}

function studentIsFromSelectedInstitution(row, students, institutionId) {
  const student = students.find(item => item && item.id === row.studentId);
  return student?.source_type === STUDENT_SOURCE_INSTITUTION && student.institution_id === institutionId;
}

function rowMatchesInstitution(row, students, institutionId) {
  if (!institutionId) return true;

  if (row.studentId === INSTITUTION_UNBOUND_STUDENT_ID) {
    return courseIsInstitutionOwned(row, institutionId);
  }

  if (Number(row.courseType) === COURSE_TYPE_ONE_ON_ONE) {
    return courseIsInstitutionOwned(row, institutionId);
  }

  if (Number(row.sourceType) !== COURSE_SOURCE_INSTITUTION && Number(row.sourceType) !== COURSE_SOURCE_MIXED) return false;
  return studentIsFromSelectedInstitution(row, students, institutionId);
}

export function filterStudentDetailsForRevenue(rows = [], students = [], filters = {}) {
  return rows.filter(row => {
    if (filters.studentId && row.studentId !== filters.studentId) return false;
    if (filters.teacherId && row.teacherId !== filters.teacherId) return false;
    if (filters.institutionId && !rowMatchesInstitution(row, students, filters.institutionId)) return false;
    return true;
  });
}

export function buildTeacherDetailsFromStudentDetails(rows = []) {
  const groupMap = new Map();

  rows.forEach(row => {
    const key = `${row.scheduleId || ''}::${row.teacherId || '__unassigned__'}`;
    const current = groupMap.get(key) || {
      key: row.scheduleId || key,
      scheduleId: row.scheduleId,
      date: row.date,
      timeRange: row.timeRange,
      startTime: row.startTime,
      endTime: row.endTime,
      courseId: row.courseId,
      courseName: row.courseName,
      courseType: row.courseType,
      courseTypeName: row.courseTypeName,
      sourceType: row.sourceType,
      sourceTypeName: row.sourceTypeName,
      institutionId: row.institutionId,
      teacherId: row.teacherId || '__unassigned__',
      teacherName: row.teacherName,
      studentNames: [],
      studentCount: 0,
      durationHours: Number(row.durationHours || 0),
      billingUnit: row.billingUnit,
      billingUnitName: row.billingUnitName,
      feeUnitPrice: 0,
      teacherFeeMode: row.teacherFeeMode,
      teacherFeeModeName: row.teacherFeeModeName,
      teacherFeeTotal: 0,
    };

    current.teacherFeeTotal = roundMoney(current.teacherFeeTotal + Number(row.teacherFeeTotal || 0));
    if (row.studentName) current.studentNames.push(row.studentName);
    if (row.studentId && row.studentId !== UNBOUND_STUDENT_ID && row.studentId !== INSTITUTION_UNBOUND_STUDENT_ID) {
      current.studentCount += 1;
    }
    groupMap.set(key, current);
  });

  return Array.from(groupMap.values())
    .map(row => ({
      ...row,
      studentNames: row.studentNames.join('、'),
      feeUnitPrice: roundMoney(
        row.billingUnit === 1 && row.durationHours > 0
          ? row.teacherFeeTotal / row.durationHours
          : row.teacherFeeTotal
      ),
    }))
    .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.teacherName || '').localeCompare(String(b.teacherName || ''), 'zh-CN'));
}
