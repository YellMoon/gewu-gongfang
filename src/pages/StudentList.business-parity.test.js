'use strict';
// UTF-8: original enrollment-year calculation must survive both cloud and draft saves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const read = file => parse(file, fs.readFileSync(path.join(root, file), 'utf8'));
const historic = file => parse(file, cp.execFileSync('git', ['show', '8118419f:' + file], { cwd: root, encoding: 'utf8' }));
function find(source, name) {
  let found;
  function visit(node) {
    if (node.name?.getText(source) === name && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node))) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source); assert(found, name); return found;
}
function load(source, name, dependencies = {}) {
  const node = find(source, name);
  const expression = ts.isVariableDeclaration(node) ? node.initializer.getText(source)
    : `function (${node.parameters.map(p => p.getText(source)).join(',')}) ${node.body.getText(source)}`;
  const compiled = ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
}

(async () => {
  const page = read('src/pages/StudentList.tsx');
  const oldDb = historic('src/services/browserDatabase.ts');
  const draftDb = read('src/services/browserDatabase.ts');
  const oldHelpers = historic('src/utils/helpers.ts');
  const helpers = read('src/utils/helpers.ts');
  const { hasPendingBusinessDraft } = await import('../services/businessDraftSubmissionGuard.mjs');
  let cases = 0;
  for (const instant of ['2026-08-31T12:00:00+08:00', '2026-09-01T12:00:00+08:00']) {
    const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } };
    const calculateGrade = load(helpers, 'calculateGrade', { Date: FixedDate });
    const oldCalculateGrade = load(oldHelpers, 'calculateGrade', { Date: FixedDate });
    for (const year of [2021, 2022, 2023, 2024, 2025, 2026, 2027]) {
      assert.equal(calculateGrade(year), oldCalculateGrade(year));
      for (const suppliedGrade of [undefined, '', '旧年级']) for (const editing of [false, true]) {
        for (const mode of editing ? ['online', 'offline', 'pending'] : ['online', 'offline']) {
          const values = { name: '林小禾', grade_year: year, grade_current: suppliedGrade, school: '春禾中学', source_type: 1, notes: '原备注' };
          const existing = { id: 'student', name: '林小禾', grade_year: 2024, grade_current: '高二', updated_at: '2026-08-30T00:00:00Z' };
          const makeDb = () => ({ data: { students: editing ? [{ ...existing }] : [], student_contacts: [] },
            generateId: () => 'new-student', addOrUpdateSchool() {}, saveData() {}, recordSyncChange() {},
            recordAuthorityDraft() {}, studentAuthorityContacts: () => [], refreshAuthorityProjection: async () => {} });
          const prior = makeDb();
          const oldMethod = load(oldDb, editing ? 'updateStudent' : 'createStudent', { calculateGrade: oldCalculateGrade, Date: FixedDate });
          const expected = editing ? oldMethod.call(prior, existing.id, { ...values }) : oldMethod.call(prior, { ...values });
          const dbService = makeDb();
          for (const name of ['createStudent', 'updateStudent']) dbService[name] = load(draftDb, name, {
            calculateGrade, Date: FixedDate, overlayStudentContactDraftProjection: (_student, contacts) => contacts,
          });
          let submitted;
          const cloud = async input => { submitted = input; };
          const dependencies = {
            window: { desktopIdentitySessionProvider: mode === 'offline' ? {} : { createCloudStudentRecord: cloud, updateCloudStudentRecord: cloud },
              desktopAuthority: { list: async () => mode === 'pending' ? [{ type: 'student.update.v1', status: 'awaiting_confirmation', payload: { id: existing.id, changes: {} } }] : [] } },
            editingStudent: editing ? existing : null, studentContacts: [], dbService, calculateGrade, hasPendingBusinessDraft,
            studentContactCommands: load(page, 'studentContactCommands', { contactText: load(page, 'contactText') }),
            message: { warning() {}, success() {}, error(text) { throw new Error(text); } },
          };
          const before = JSON.stringify(values);
          const result = await load(page, editing ? 'submitExistingStudentToAuthority' : 'submitNewStudentToAuthority', dependencies)(values);
          assert.equal(result, true);
          const actual = submitted ? { grade_year: submitted.gradeYear, grade_current: submitted.gradeCurrent } : dbService.data.students[0];
          assert.equal(actual.grade_year, expected.grade_year);
          assert.equal(actual.grade_current, expected.grade_current, `${editing ? 'update' : 'create'} ${mode} year=${year} must keep original grade calculation`);
          assert.equal(JSON.stringify(values), before, 'submission must not modify original form values');
          assert.equal(Boolean(submitted), mode === 'online');
          cases++;
        }
      }
    }
  }
  console.log(`student original enrollment-grade save parity passed: ${cases} cases`);
})().catch(error => { console.error(error); process.exitCode = 1; });
