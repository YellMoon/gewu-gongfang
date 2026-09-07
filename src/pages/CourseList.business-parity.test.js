// UTF-8. Exercise the real original-form submit handler, not a replacement form.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
(async () => {
  const source = ts.createSourceFile('CourseList.tsx', fs.readFileSync(path.join(__dirname, 'CourseList.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler, submitHandler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSubmit') handler = node.initializer;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'submitCourseToAuthority') submitHandler = node.initializer;
    ts.forEachChild(node, visit);
  }
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
  // UTF-8 readable fixture names, never tracking codes in the UI.
  for (const existing of [false, true]) {
    let submitted; let created = 0;
    const rooms = existing ? [{ id: 'room-stored', name: '新地址' }] : [];
    const values = { display_name: '物理课', type: 1, source_type: 1, teacher_id: 't1', year: 2026, semester: '秋学期', room_id: '新地址', color: '#fff', student_pricings: [] };
    const dependencies = {
      form: { getFieldsValue: () => values, validateFields: async () => values }, editingCourse: null,
      CourseSourceType: { INSTITUTION: 2, MIXED: 3 }, message: { warning: text => { throw new Error(text); } },
      sanitizeCourseStudentPricings: v => v, students: [], teachers: [{ id: 't1', name: '教师' }], rooms,
      dbService: { addOrUpdateRoom(name) { created++; rooms.push({ id: 'room-stored', name }); }, getAllRooms: () => rooms },
      submitCourseToAuthority: async v => { submitted = { ...v }; return true; },
      setModalVisible() {}, setTimeout: f => f(), loadData() {}, console: { error() {} },
    };
    await new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))();
    assert(submitted, 'original form must accept an inline address without redirecting to another page');
    assert.equal(submitted.room_id, 'room-stored');
    assert.equal(created, existing ? 0 : 1);
  }
  assert(submitHandler);
  const submitCompiled = ts.transpileModule(`return (${submitHandler.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const pending of [false, true]) for (const edit of [false, true]) {
    const calls = [];
    const dependencies = {
      window: {
        desktopIdentitySessionProvider: { createCloudCourse: async () => calls.push('cloud'), updateCloudCourse: async () => calls.push('cloud') },
        desktopAuthority: { list: async () => pending ? [{ type: 'room.create.v1', status: 'awaiting_confirmation', payload: { record: { id: 'room' } } }] : [] },
      },
      editingCourse: edit ? { id: 'course', updated_at: '2026-09-07T00:00:00Z' } : null,
      dbService: { createCourse: () => calls.push('draft'), updateCourse: () => calls.push('draft'), refreshAuthorityProjection: async () => {} },
      syncSchedulesRoomName: () => {}, courseCloudPayload: v => v, message: { warning() {}, success() {}, error() {} },
    };
    assert.equal(await new Function(...Object.keys(dependencies), submitCompiled)(...Object.values(dependencies))({ room_id: 'room' }), true);
    assert.deepEqual(calls, [pending ? 'draft' : 'cloud'], 'online course save must not bypass an unconfirmed address draft');
  }
  console.log('course original-form year and inline-address preservation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
