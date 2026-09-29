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
      durationMinutes: 0,
      durationCounts: {},
    };
    current.tuitionAmount = roundMoney(current.tuitionAmount + Number(row.tuitionTotal || 0));
    current.teacherFeeAmount = roundMoney(current.teacherFeeAmount + Number(row.teacherFeeTotal || 0));
    current.courseCount += 1;
    addDurationStats(current, row);
    current.durationHours = current.durationMinutes / 60;
    sourceMap.set(source.sourceKey, current);
  });

  return Array.from(sourceMap.values()).sort((a, b) => {
    if (a.sourceKey === 'self') return -1;
    if (b.sourceKey === 'self') return 1;
    return b.teacherFeeAmount - a.teacherFeeAmount || a.sourceName.localeCompare(b.sourceName, 'zh-CN');
  });
}

// Older callers may still supply hours; all accumulation uses integer minutes.
function addDurationStats(summary, row) {
  const minutes = Math.max(0, Math.round(Number(row.durationMinutes ?? Number(row.durationHours || 0) * 60)));
  if (Number(row.billingUnit) === 2) {
    summary.sessionDurationCounts ||= {};
    summary.sessionDurationCounts[minutes] = (summary.sessionDurationCounts[minutes] || 0) + 1;
  } else {
    summary.hourlyMinutes = (summary.hourlyMinutes || 0) + minutes;
  }
  summary.durationMinutes += minutes;
  summary.durationCounts[minutes] = (summary.durationCounts[minutes] || 0) + 1;
}

function formatDurationBreakdown(counts = {}) {
  return Object.entries(counts).sort(([a], [b]) => Number(a) - Number(b))
    .map(([minutes, count]) => `${minutes}分钟 × ${count}节`).join('、');
}

function formatDetailDuration(row) {
  return Number(row.billingUnit) === 2
    ? `${row.durationMinutes} 分钟`
    : `${roundMoney(row.durationMinutes / 60)} 小时`;
}

function formatDurationSummary(summary) {
  return `${roundMoney(Number(summary.durationMinutes || 0) / 60)} 小时`;
}

module.exports = { buildSourceStats, addDurationStats, formatDurationBreakdown, formatDurationSummary, formatDetailDuration };
