const INSTITUTION_STUDENT_SUFFIX = '\u5b66\u751f';
export function buildInstitutionStudentName(name) { return String(name || '').trim() + INSTITUTION_STUDENT_SUFFIX; }
export function isInstitutionStudent(s) { return s?.is_institution_student === true || Number(s?.is_institution_student) === 1; }
export function buildInstitutionStudentRecord(i, id, now = new Date().toISOString()) {
  return { id, name: buildInstitutionStudentName(i?.name), source_type: 2, institution_id: i?.id,
    is_institution_student: true, balance_hours: 0, balance_money: 0, notes: '\u673a\u6784\u8bfe\u7a0b\u8d39\u7528\u4e13\u7528\u5b66\u751f', created_at: now, updated_at: now };
}
export function ensureInstitutionStudents(institutions = [], students = [], idFactory, now = new Date().toISOString()) {
  const result = [...students]; const created = []; const updated = [];
  for (const i of institutions) {
    const existing = result.find(s => isInstitutionStudent(s) && s.institution_id === i.id);
    if (existing) { const name = buildInstitutionStudentName(i.name); if (existing.name !== name || existing.source_type !== 2) { existing.name = name; existing.source_type = 2; existing.updated_at = now; updated.push(existing); } continue; }
    const record = buildInstitutionStudentRecord(i, idFactory(i.id), now); result.push(record); created.push(record);
  }
  return { students: result, created, updated };
}
