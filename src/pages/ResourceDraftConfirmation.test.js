'use strict';
// UTF-8: execute the original resource submit/delete functions at their cloud boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const transpile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
(async () => {
  const guardPath = path.join(__dirname, '../services/businessDraftSubmissionGuard.mjs');
  const guard = fs.existsSync(guardPath) ? (await import('../services/businessDraftSubmissionGuard.mjs')).hasPendingBusinessDraft : undefined;
  let cases = 0;
  for (const [entity, page, editName, submitName, api] of [
    ['student', 'StudentList', 'editingStudent', 'submitExistingStudentToAuthority', 'StudentRecord'],
    ['teacher', 'TeacherList', 'editingTeacher', 'submitTeacherToAuthority', 'Teacher'],
    ['room', 'RoomManager', 'editingRoom', 'submitRoomToAuthority', 'Room'],
  ]) {
    const source = ts.createSourceFile(page + '.tsx', fs.readFileSync(path.join(__dirname, page + '.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const named = new Map();
    function visit(node) {
      if (ts.isVariableDeclaration(node)) named.set(node.name.getText(source), node.initializer?.getText(source));
      if (ts.isFunctionDeclaration(node)) named.set(node.name?.text, node.getText(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const action of ['handleDelete', submitName]) for (const operation of ['create', 'update', 'delete']) {
      for (const status of ['awaiting_confirmation', 'confirmed', 'submitted', 'conflict', 'completed']) for (const same of [true, false]) {
        const calls = [], record = { id: 'record', name: '测试资料', phone: '13100000000', updated_at: '2026-09-08T00:00:00Z' };
        const id = same ? record.id : 'other';
        const draft = { type: `${entity}.${operation}.v1`, status, payload: operation === 'create' ? { record: { ...record, id } } : { id, changes: { name: record.name } } };
        const before = JSON.stringify(draft);
        const noun = entity[0].toUpperCase() + entity.slice(1);
        const env = {
          [editName]: record, [entity === 'room' ? 'rooms' : entity + 's']: [record],
          window: { desktopAuthority: { list: async () => [draft] }, desktopIdentitySessionProvider: {
            ['updateCloud' + api]: async () => calls.push('cloud'), ['deleteCloud' + noun]: async () => calls.push('cloud'),
          } },
          dbService: { ['update' + noun]: () => calls.push('draft'), ['delete' + noun]: () => calls.push('draft'), refreshAuthorityProjection: async () => {} },
          message: { success() {}, warning() {}, error: text => { throw new Error(text); } }, loadData() {}, studentContacts: [],
          hasPendingBusinessDraft: guard,
        };
        const contactFunctions = entity === 'student' ? named.get('contactText') + '\n' + named.get('studentContactCommands') : '';
        const execute = new Function(...Object.keys(env), transpile(contactFunctions + `\nreturn (${named.get(action)});`))(...Object.values(env));
        await execute(action === 'handleDelete' ? record.id : record);
        assert.deepEqual(calls, [same && status !== 'completed' ? 'draft' : 'cloud'], `${page}/${action}/${operation}/${status} must not bypass earlier confirmation`);
        assert.equal(JSON.stringify(draft), before);
        cases++;
      }
    }
  }
  // UTF-8: another entity with the same ID cannot block this one; read failures never imply clean state.
  assert.equal(await guard({ list: async () => [{ type: 'teacher.update.v1', status: 'awaiting_confirmation', payload: { id: 'same-id' } }] }, 'student', 'same-id'), false);
  await assert.rejects(() => guard({ list: async () => { throw new Error('OUTBOX_READ_FAILED'); } }, 'student', 'same-id'), /OUTBOX_READ_FAILED/);
  console.log('resource draft confirmation boundary checks passed: ' + cases);
})().catch(error => { console.error(error); process.exitCode = 1; });
