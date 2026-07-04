const assert = require('assert');

(async () => {
  const {
    hasEffectiveStudentPricings,
    isPureInstitutionCourseWithoutStudents,
  } = await import('./coursePricingRules.mjs');

  const INSTITUTION = 2;
  const MIXED = 3;

  assert.strictEqual(hasEffectiveStudentPricings(undefined), false);
  assert.strictEqual(hasEffectiveStudentPricings([]), false);
  assert.strictEqual(hasEffectiveStudentPricings([undefined, null, {}, { teacher_fee: 80 }, { student_id: '' }]), false);
  assert.strictEqual(hasEffectiveStudentPricings([{ student_id: '__institution_unbound__', tuition: 300, teacher_fee: 120 }]), false);
  assert.strictEqual(hasEffectiveStudentPricings([{ student_id: 'student-1', tuition: 300, teacher_fee: 120 }]), true);

  assert.strictEqual(isPureInstitutionCourseWithoutStudents(INSTITUTION, [{ teacher_fee: 80 }]), true);
  assert.strictEqual(isPureInstitutionCourseWithoutStudents(INSTITUTION, [{ student_id: '__institution_unbound__' }]), true);
  assert.strictEqual(isPureInstitutionCourseWithoutStudents(INSTITUTION, [{ student_id: 'student-1' }]), false);
  assert.strictEqual(isPureInstitutionCourseWithoutStudents(MIXED, []), false);

  console.log('coursePricingRules tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
