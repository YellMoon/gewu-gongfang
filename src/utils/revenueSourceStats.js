const STUDENT_SOURCE_INSTITUTION = 2;
const INSTITUTION_UNBOUND_STUDENT_ID = '__institution_unbound__';

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function findInstitutionName(institutions, id) {
  if (!id) return undefined;
  return institutions.find(item => item && item.id === id)?.name;
}

function resolveSource(row, students, institutions) {
  const student = students.find(item => item && item.id === row.studentId);
  if (student?.source_type === STUDENT_SOURCE_INSTITUTION && student.institution_id) {
    return {
      sourceKey: `institution:${student.institution_id}`,
      sourceName: findInstitutionName(institutions, student.institution_id) || '未知机构',
    };
  }

  if (row.studentId === INSTITUTION_UNBOUND_STUDENT_ID && row.institutionId) {
    return {
      sourceKey: `institution:${row.institutionId}`,
      sourceName: findInstitutionName(institutions, row.institutionId) || '机构排课',
    };
  }

  return { sourceKey: 'self', sourceName: '自有' };
}

function buildSourceStats(rows = [], students = [], institutions = []) {
  const sourceMap = new Map();

  rows.forEach(row => {
    const source = resolveSource(row, students, institutions);
    const current = sourceMap.get(source.sourceKey) || {
      sourceKey: source.sourceKey,
      sourceName: source.sourceName,
      tuitionAmount: 0,
      teacherFeeAmount: 0,
      courseCount: 0,
      durationHours: 0,
    };
    current.tuitionAmount = roundMoney(current.tuitionAmount + Number(row.tuitionTotal || 0));
    current.teacherFeeAmount = roundMoney(current.teacherFeeAmount + Number(row.teacherFeeTotal || 0));
    current.courseCount += 1;
    current.durationHours = roundMoney(current.durationHours + Number(row.durationHours || 0));
    sourceMap.set(source.sourceKey, current);
  });

  return Array.from(sourceMap.values()).sort((a, b) => {
    if (a.sourceKey === 'self') return -1;
    if (b.sourceKey === 'self') return 1;
    return b.teacherFeeAmount - a.teacherFeeAmount || a.sourceName.localeCompare(b.sourceName, 'zh-CN');
  });
}

module.exports = { buildSourceStats };
