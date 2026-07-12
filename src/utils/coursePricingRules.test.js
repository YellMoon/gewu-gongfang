const assert = require('assert');

(async () => {
  const {
    getEligibleCourseStudents,
    sanitizeCourseStudentPricings,
  } = await import('./coursePricingRules.mjs');

  const INSTITUTION = 2;
  const MIXED = 3;

  const students = [
    { id: 'self', source_type: 1 },
    { id: 'inst-a-child', source_type: 2, institution_id: 'inst-a' },
    { id: 'inst-a-managed', source_type: 2, institution_id: 'inst-a', is_institution_student: true },
    { id: 'inst-b-managed', source_type: 2, institution_id: 'inst-b', is_institution_student: true },
  ];

  assert.deepStrictEqual(getEligibleCourseStudents(students, INSTITUTION, 'inst-a').map(student => student.id), ['inst-a-child', 'inst-a-managed']);
  assert.deepStrictEqual(getEligibleCourseStudents(students, MIXED, 'inst-a').map(student => student.id), ['self', 'inst-a-child', 'inst-a-managed']);
  assert.deepStrictEqual(
    sanitizeCourseStudentPricings([{ student_id: 'self' }, { student_id: 'inst-b-managed' }, { student_id: 'inst-a-managed' }], students, INSTITUTION, 'inst-a'),
    [{ student_id: 'inst-a-managed' }]
  );

  console.log('coursePricingRules institution student tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
