const assert = require('assert');

(async () => {
  const rules = await import('./institutionStudent.mjs');
  const east = '\u65b0\u4e1c\u65b9';
  const suffix = '\u5b66\u751f';

  assert.strictEqual(rules.buildInstitutionStudentName(east), `${east}${suffix}`);
  assert.strictEqual(rules.buildInstitutionStudentName(` ${east} `), `${east}${suffix}`);

  const institution = { id: 'inst-a', name: east };
  const ordinary = { id: 'ordinary', name: '\u5f20\u4e09', source_type: 2, institution_id: 'inst-a' };
  const managed = rules.buildInstitutionStudentRecord(institution, 'student-a', '2026-07-12T00:00:00.000Z');
  assert.strictEqual(managed.name, `${east}${suffix}`);
  assert.strictEqual(managed.source_type, 2);
  assert.strictEqual(managed.institution_id, 'inst-a');
  assert.strictEqual(managed.is_institution_student, true);
  assert.strictEqual(rules.isInstitutionStudent(managed), true);
  assert.strictEqual(rules.isInstitutionStudent(ordinary), false);

  const ensured = rules.ensureInstitutionStudents(
    [institution, { id: 'inst-b', name: '\u5b66\u800c\u601d' }],
    [ordinary, managed],
    (institutionId) => `generated-${institutionId}`,
    '2026-07-12T00:00:00.000Z'
  );
  assert.strictEqual(ensured.created.length, 1);
  assert.strictEqual(ensured.created[0].id, 'generated-inst-b');
  assert.strictEqual(ensured.students.filter(rules.isInstitutionStudent).length, 2);

  console.log('institutionStudent tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
