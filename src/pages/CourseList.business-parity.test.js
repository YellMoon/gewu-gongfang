// UTF-8. Exercise the real original-form submit handler, not a replacement form.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
(async () => {
  const source = ts.createSourceFile('CourseList.tsx', fs.readFileSync(path.join(__dirname, 'CourseList.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSubmit') handler = node.initializer; ts.forEachChild(node, visit); }
  visit(source); assert(handler);
  const compiled = ts.transpileModule(`return (${handler.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const [year, expected] of [[undefined, 2024], [null, 2024], [2027, 2027]]) {
    let submitted;
    const values = { display_name: '原课程', type: 1, source_type: 1, teacher_id: 't1', year, semester: '秋学期', room_id: 'r1', student_pricings: [], color: '#ffffff' };
    const dependencies = {
      form: { getFieldsValue: () => ({ ...values, year: 2024 }), validateFields: async () => values },
      editingCourse: { id: 'c1', year: 2024 }, CourseSourceType: { INSTITUTION: 2, MIXED: 3 },
      message: { warning: text => { throw new Error(text); } },
      sanitizeCourseStudentPricings: value => value, students: [], teachers: [{ id: 't1', name: '教师' }],
      rooms: [{ id: 'r1', name: '原地址' }], dbService: {},
      submitCourseToAuthority: async value => { submitted = { ...value }; return true; },
      setModalVisible: () => {}, setTimeout: callback => callback(), loadData: () => {}, console,
    };
    await new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))();
    assert(submitted, 'original form must reach its submission boundary');
    assert.equal(submitted.year, expected, 'editing must retain the original year when validated fields omit it');
    assert.equal(submitted.room_name, '原地址'); assert.equal(submitted.teacher_name, '教师');
  }
  console.log('course original-form year preservation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
