// UTF-8. Execute real cache methods, without network or persistent user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, 'browserDatabase.ts'), 'utf8');
const ast = ts.createSourceFile('browserDatabase.ts', source, ts.ScriptTarget.Latest, true);
const methods = [];
const names = ['createStudent', 'updateStudent', 'getSchoolNames', 'addOrUpdateSchool'];
function visit(n) {
  if (ts.isMethodDeclaration(n) && names.includes(n.name.getText(ast))) methods.push(n.getText(ast));
  ts.forEachChild(n, visit);
}
visit(ast);
const Cache = new Function('calculateGrade', 'overlayStudentContactDraftProjection',
  ts.transpileModule(`class Cache {${methods.join('\n')}}; return Cache;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText)(() => 'Grade', (_student, contacts) => contacts);
const original = { id: 'student-old', name: 'Student', school: 'Old school', updated_at: '2026-09-07T00:00:00Z' };
const school = { id: 'school-existing', name: 'Existing school', count: 7, updated_at: original.updated_at };
for (const edit of [false, true]) {
  for (const name of ['New school', school.name, '', null]) {
    const cache = new Cache();
    cache.data = structuredClone({ students: edit ? [original] : [], schools: [school], student_contacts: [] });
    const calls = [];
    cache.generateId = () => 'student-new';
    cache.studentAuthorityContacts = () => [];
    cache.recordAuthorityDraft = (...args) => calls.push({ kind: 'draft', args: structuredClone(args) });
    cache.saveData = () => calls.push({ kind: 'save' });
    const input = { name: 'Student', school: name };
    const before = structuredClone(input);
    if (edit) cache.updateStudent(original.id, input); else cache.createStudent(input);
    assert.deepEqual(calls.map(c => c.kind), ['draft', 'save'], 'one student confirmation must own school registration; no independent school draft/save');
    assert.equal(calls[0].args[0], 'students');
    assert.equal(calls[0].args[3].school, name);
    if (edit) assert.equal(calls[0].args[4], original.updated_at);
    assert.deepEqual(cache.data.schools, [school], 'student draft must not mutate cloud school IDs, counts or versions');
    assert.deepEqual(input, before);
    assert.deepEqual(cache.getSchoolNames(), [...new Set([school.name, name].filter(Boolean))].sort(), 'typed school remains available from the local student draft');
  }
}
console.log('student school derived-cache and single confirmation checks passed');
