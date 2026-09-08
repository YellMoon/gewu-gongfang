'use strict';
// UTF-8: an acknowledged write must never become another draft because its readback failed.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const parse = page => ts.createSourceFile(page + '.tsx', fs.readFileSync(path.join(__dirname, page + '.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functions(source) {
  const named = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) named.set(node.name.getText(source), node.initializer.getText(source));
    if (ts.isFunctionDeclaration(node)) named.set(node.name?.text, `function(${node.parameters.map(p => p.getText(source)).join(',')})${node.body.getText(source)}`);
    ts.forEachChild(node, visit);
  }
  visit(source); return named;
}
function compile(named, name, deps) {
  assert(named.has(name), name);
  return new Function(...Object.keys(deps), ts.transpileModule(`return (${named.get(name)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(deps));
}
(async () => {
  const { hasPendingBusinessDraft } = await import('../services/businessDraftSubmissionGuard.mjs');
  let cases = 0;
  for (const [entity, page, submit, api] of [
    ['student', 'StudentList', 'submitExistingStudentToAuthority', 'StudentRecord'],
    ['teacher', 'TeacherList', 'submitTeacherToAuthority', 'Teacher'],
    ['room', 'RoomManager', 'submitRoomToAuthority', 'Room'],
    ['course', 'CourseList', 'submitCourseToAuthority', 'Course'],
  ]) {
    const named = functions(parse(page));
    for (const action of ['create', 'update', 'delete', ...(entity === 'course' ? ['toggle'] : [])]) {
      for (const failure of ['read-network', 'read-session', 'read-invalid', 'write-offline', 'write-denied', 'none']) {
        const noun = entity[0].toUpperCase() + entity.slice(1);
        const record = { id: 'record', name: '测试资料', updated_at: '2026-09-08T00:00:00Z', active: true };
        const events = [], messages = [];
        const cloud = async () => {
          events.push('cloud');
          if (failure === 'write-offline') throw Object.assign(new Error('ONLINE_DESKTOP_SESSION_REQUIRED'), { code: 'ONLINE_DESKTOP_SESSION_REQUIRED' });
          if (failure === 'write-denied') throw Object.assign(new Error('CLOUD_BUSINESS_ACCESS_DENIED'), { code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
          return { id: record.id, updatedAt: '2026-09-08T01:00:00Z' };
        };
        const dbService = { refreshAuthorityProjection: async () => {
          events.push('refresh');
          if (failure === 'read-network') throw new TypeError('Failed to fetch');
          if (failure === 'read-session') throw Object.assign(new Error('ONLINE_DESKTOP_SESSION_REQUIRED'), { code: 'ONLINE_DESKTOP_SESSION_REQUIRED' });
          if (failure === 'read-invalid') throw new Error('INVALID_PROJECTION');
        } };
        for (const operation of ['create', 'update', 'delete']) dbService[operation + noun] = () => events.push('draft');
        dbService.addOrUpdateRoom = () => events.push('draft');
        const window = { desktopAuthority: { list: async () => [] }, desktopIdentitySessionProvider: {
          ['createCloud' + api]: cloud, ['updateCloud' + api]: cloud, ['deleteCloud' + noun]: cloud,
        } };
        const deps = { window, dbService, ['editing' + noun]: action === 'create' ? null : record,
          [entity === 'room' ? 'rooms' : entity + 's']: [record], studentContacts: [],
          hasPendingBusinessDraft, calculateGrade: () => '高一', courseCloudPayload: x => x,
          syncSchedulesRoomName: () => events.push('link'), loadData: () => events.push('load'),
          message: Object.fromEntries(['success', 'warning', 'error'].map(kind => [kind, text => messages.push({ kind, text })])),
        };
        if (entity === 'student') deps.studentContactCommands = compile(named, 'studentContactCommands', { contactText: compile(named, 'contactText', {}) });
        if (entity === 'course') {
          deps.hasPendingCourseDraft = compile(named, 'hasPendingCourseDraft', { window });
          deps.isOfflineCloudFailure = compile(named, 'isOfflineCloudFailure', {});
        }
        const name = action === 'delete' ? 'handleDelete' : action === 'toggle' ? 'handleToggleActive'
          : entity === 'student' && action === 'create' ? 'submitNewStudentToAuthority' : submit;
        const result = await compile(named, name, deps)(action === 'delete' ? record.id : record);
        assert.equal(events.filter(e => e === 'cloud').length, 1);
        assert.equal(events.filter(e => e === 'draft').length, failure === 'write-offline' ? 1 : 0,
          `${page}/${action}/${failure}: an acknowledged write must not be staged again`);
        if (failure.startsWith('read-')) {
          assert(messages.some(m => m.kind === 'warning' && /刷新|更新/.test(m.text)), 'readback failure needs an accurate refresh warning');
          assert(!messages.some(m => m.kind === 'error' || /草稿|待确认/.test(m.text)), 'must not report a completed write as failed or pending');
          if (action === 'create' || action === 'update') assert.equal(result, true, 'completed form must close so creation is not repeated');
          if (entity === 'course' && ['create', 'update'].includes(action)) assert.equal(events.filter(e => e === 'link').length, 1, 'readback failure must not drop original course-address linkage');
        }
        if (failure.startsWith('write-')) assert(!events.includes('refresh'), 'rejected writes must not claim to refresh an acknowledged result');
        cases++;
      }
    }
  }
  console.log('acknowledged business write/readback separation passed: ' + cases + ' cases');
})().catch(error => { console.error(error); process.exitCode = 1; });
