export const INSTITUTION_UNBOUND_STUDENT_ID = '__institution_unbound__';

export function hasEffectiveStudentPricings(pricings = []) {
  if (!Array.isArray(pricings)) return false;
  return pricings.some((pricing) => {
    const studentId = String(pricing?.student_id || '').trim();
    return Boolean(studentId && studentId !== INSTITUTION_UNBOUND_STUDENT_ID);
  });
}

export function isPureInstitutionCourseWithoutStudents(sourceType, pricings = []) {
  return Number(sourceType) === 2 && !hasEffectiveStudentPricings(pricings);
}
