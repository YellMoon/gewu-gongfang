// UTF-8. Exercise the real original-form submit handler, not a replacement form.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
(async () => {
  const source = ts.createSourceFile('CourseList.tsx', fs.readFileSync(path.join(__dirname, 'CourseList.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler, submitHandler;
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(source), node.initializer);
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
    // UTF-8: execute the real new guard with the same outbox, not a test replacement.
    if (declarations.has('hasPendingCourseDraft')) dependencies.hasPendingCourseDraft = new Function('window',
      ts.transpileModule(`return (${declarations.get('hasPendingCourseDraft').getText(source)});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
      }).outputText)(dependencies.window);
    assert.equal(await new Function(...Object.keys(dependencies), submitCompiled)(...Object.values(dependencies))({ room_id: 'room' }), true);
    assert.deepEqual(calls, [pending ? 'draft' : 'cloud'], 'online course save must not bypass an unconfirmed address draft');
  }
  // UTF-8: reconnecting must not piggyback an older draft on a new course action.
  for (const operation of ['create', 'update', 'delete']) for (const status of ['awaiting_confirmation', 'confirmed', 'submitted', 'conflict', 'completed']) {
    for (const action of ['submitCourseToAuthority', 'handleToggleActive', 'handleDelete']) {
      for (const sameCourse of [true, false]) {
        const calls = [];
        const course = { id: 'course', updated_at: '2026-09-08T00:00:00Z', active: true, room_id: 'room', notes: '尚未确认的备注' };
        const recordId = sameCourse ? 'course' : 'other';
        const draft = { type: `course.${operation}.v1`, status, payload: operation === 'create'
          ? { record: { ...course, id: recordId } } : { id: recordId, changes: { notes: course.notes } } };
        const draftBefore = JSON.stringify(draft);
        const dependencies = {
          window: { desktopAuthority: { list: async () => [draft] }, desktopIdentitySessionProvider: {
            updateCloudCourse: async () => calls.push('cloud'), deleteCloudCourse: async () => calls.push('cloud'),
          } },
          courses: [course], editingCourse: course, courseCloudPayload: value => value,
          dbService: { updateCourse: () => calls.push('draft'), deleteCourse: () => calls.push('draft'), refreshAuthorityProjection: async () => {} },
          syncSchedulesRoomName() {}, loadData() {}, isOfflineCloudFailure: () => false,
          message: { warning() {}, success() {}, error: text => { throw new Error(text); } },
        };
        const expression = name => ts.transpileModule(`return (${declarations.get(name).getText(source)});`, {
          compilerOptions: { target: ts.ScriptTarget.ES2020 },
        }).outputText;
        if (declarations.has('hasPendingCourseDraft')) dependencies.hasPendingCourseDraft = new Function('window', expression('hasPendingCourseDraft'))(dependencies.window);
        const execute = new Function(...Object.keys(dependencies), expression(action))(...Object.values(dependencies));
        await execute(action === 'handleDelete' ? course.id : course);
        assert.deepEqual(calls, [sameCourse && status !== 'completed' ? 'draft' : 'cloud'],
          action + ' must retain unfinished course edits for explicit confirmation, without blocking unrelated/completed drafts');
        assert.equal(JSON.stringify(draft), draftBefore, 'the guard cannot rewrite a stored or confirmed draft');
      }
    }
  }
  console.log('course original-form year, inline-address and 90 pending-course confirmation cases passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
