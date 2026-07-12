export function getEligibleCourseStudents(students = [], sourceType, institutionId) {
  const source = Number(sourceType);
  if (source === 1) return students.filter(s => Number(s?.source_type || 1) === 1);
  if (!institutionId) return source === 3 ? students.filter(s => Number(s?.source_type || 1) === 1) : [];
  if (source === 2) return students.filter(s => Number(s?.source_type) === 2 && s?.institution_id === institutionId);
  if (source === 3) return students.filter(s => Number(s?.source_type || 1) === 1 || (Number(s?.source_type) === 2 && s?.institution_id === institutionId));
  return students;
}
export function sanitizeCourseStudentPricings(pricings = [], students = [], sourceType, institutionId) {
  const ids = new Set(getEligibleCourseStudents(students, sourceType, institutionId).map(s => s.id));
  return (Array.isArray(pricings) ? pricings : []).filter(p => ids.has(p?.student_id));
}
