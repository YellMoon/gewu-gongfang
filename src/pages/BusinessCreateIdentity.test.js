'use strict';
// UTF-8: keep one resource identity across a request and its offline fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function source(file) { return ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
function load(ast, name, deps = {}) {
  let found;
  function visit(n) { if (n.name?.getText(ast) === name && (ts.isVariableDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n))) found = n; ts.forEachChild(n, visit); }
  visit(ast); assert(found, name);
  const text = ts.isVariableDeclaration(found) ? found.initializer.getText(ast) : `function(${found.parameters.map(p => p.getText(ast)).join(',')})${found.body.getText(ast)}`;
  return new Function(...Object.keys(deps), ts.transpileModule(`return (${text});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(deps));
}
(async () => {
  const database = source('../services/browserDatabase.ts');
  const { buildAuthorityBackedBrowserCache } = await import('../services/authorityProjectionCacheAdapter.mjs');
  let cases = 0;
  for (const [entity, page, handler, api, method] of [
    ['student', 'StudentList', 'submitNewStudentToAuthority', 'StudentRecord', 'createStudent'],
    ['teacher', 'TeacherList', 'submitTeacherToAuthority', 'Teacher', 'createTeacher'],
    ['course', 'CourseList', 'submitCourseToAuthority', 'Course', 'createCourse'],
    ['room', 'RoomManager', 'submitRoomToAuthority', 'Room', 'addOrUpdateRoom'],
  ]) for (const outcome of ['offline', 'before-send', 'lost-reply']) {
    const ast = source(page + '.tsx'); const records = []; let generated = 0, attemptedId;
    const values = { name: '测试资料', room_id: 'r1', room_name: '原地址', address: '原地址', grade_year: 2026, phone: '13100000000' };
    const dbService = { data: { [entity + 's']: [] }, generateId: () => `local-${++generated}`, saveData() {},
      studentAuthorityContacts: () => [], resolveCourseDraftRoom: () => null,
      recordAuthorityDraft: (collection, action, id, value) => records.push({ collection, action, id, value: structuredClone(value) }) };
    dbService[method] = load(database, method, { calculateGrade: () => '高一' });
    const cloud = async input => { attemptedId = input[entity + 'Id']; throw new TypeError('Failed to fetch'); };
    const window = { desktopIdentitySessionProvider: outcome === 'offline' ? {} : { ['createCloud' + api]: cloud }, desktopAuthority: { list: async () => [] } };
    const deps = { window, dbService, ['editing' + entity[0].toUpperCase() + entity.slice(1)]: null,
      courseCloudPayload: x => x, syncSchedulesRoomName() {}, calculateGrade: () => '高一',
      message: { warning() {}, success() {}, error(text) { throw new Error(text); } } };
    if (entity === 'student') deps.studentContactCommands = load(ast, 'studentContactCommands', { contactText: load(ast, 'contactText') });
    if (entity === 'course') deps.isOfflineCloudFailure = load(ast, 'isOfflineCloudFailure');
    assert.equal(await load(ast, handler, deps)(values), true);
    assert.equal(records.length, 1);
    const draft = records[0];
    assert.equal(draft.action, 'create');
    assert.equal(draft.id, attemptedId || 'local-1', `${entity}/${outcome} must not replace the attempted resource ID`);
    assert.equal(draft.value.id, draft.id);
    assert.equal(generated, outcome === 'offline' ? 1 : 0, 'do not allocate a second identity after a send attempt');
    const cache = buildAuthorityBackedBrowserCache({ projection: { protocol: 'gewu.authority-projection.v1', sourceVersion: 1, payload: { [entity + 's']: outcome === 'lost-reply' ? [{ ...draft.value, notes: 'cloud copy' }] : [] } },
      outbox: [{ type: entity + '.create.v1', status: 'awaiting_confirmation', payload: { record: draft.value } }] });
    assert.equal(cache[entity + 's'].length, 1, 'cloud readback and pending draft must refer to one record');
    const invokeWithId = id => entity === 'room' ? dbService[method](values.name, values.address, id) : dbService[method](values, id);
    for (const id of [draft.id, '', '  invalid  ']) {
      const before = JSON.stringify(dbService.data), recorded = records.length;
      assert.throws(() => invokeWithId(id), /AUTHORITY_DRAFT_CREATE_ID_INVALID_OR_EXISTS/);
      assert.equal(JSON.stringify(dbService.data), before, 'invalid or existing IDs must not overwrite cache data');
      assert.equal(records.length, recorded, 'rejected IDs must not enqueue writes');
    }
    if (entity === 'room' && outcome === 'offline') {
      const existing = structuredClone(dbService.data.rooms[0]);
      dbService.addOrUpdateRoom(values.name, 'changed');
      assert.equal(dbService.data.rooms[0].id, existing.id);
      assert.equal(dbService.data.rooms[0].count, existing.count + 1, 'ordinary offline name reuse must retain original behavior');
      const before = structuredClone(dbService.data.rooms[0]);
      dbService.addOrUpdateRoom(values.name, 'uncertain attempted create', 'attempted-new-id');
      assert.deepEqual(dbService.data.rooms[0], before, 'an attempted create must not turn into editing an unrelated same-name room');
      assert.equal(records.at(-1).id, 'attempted-new-id');
      assert.equal(records.at(-1).action, 'create');
    }
    cases++;
  }
  console.log('business create request/draft identity checks passed: ' + cases);
})().catch(error => { console.error(error); process.exitCode = 1; });
