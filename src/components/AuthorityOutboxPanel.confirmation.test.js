// UTF-8: render and execute the actual confirmation event handler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { Descriptions } = require('antd');
const { renderToStaticMarkup } = require('react-dom/server');
(async () => {
  const { courseRoomDraftDependencies, draftConfirmationSnapshot } = await import('../services/authorityDraftDependencies.mjs');
  const { describeAuthorityDraft, authorityDraftError } = require('./authorityDraftPresentation');
  const ast = ts.createSourceFile('Panel.tsx', fs.readFileSync(path.join(__dirname, 'AuthorityOutboxPanel.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'confirmAndSubmit') handler = n.initializer; ts.forEachChild(n, visit); }
  visit(ast); assert(handler);
  const compiled = ts.transpileModule(`return (${handler.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const room = { id: 'room-draft', type: 'room.create.v1', status: 'awaiting_confirmation', payload: { record: { id: 'room', name: '湖畔教室' } } };
  const course = { id: 'course-draft', type: 'course.create.v1', status: 'awaiting_confirmation', payload: { record: { id: 'course', name: '物理提高课', room_id: 'room' } } };
  // UTF-8: the panel list deliberately lags behind the stored drafts.
  let modal; const calls = []; const errors = [];
  const freshRoom = { ...room, payload: { record: { ...room.payload.record, name: '湖畔新教室' } } };
  const freshCourse = { ...course, payload: { record: { ...course.payload.record, name: '物理最新课程' } } };
  let current = [freshRoom, freshCourse]; let readError = false;
  const deps = { React, Descriptions, items: [room, course], courseRoomDraftDependencies, draftConfirmationSnapshot,
    draftPresentation: d => describeAuthorityDraft(d), describeAuthorityDraft, authorityDraftError,
    Modal: { confirm: config => { modal = config; } }, copy: { modalTitle: '确认提交更改', confirm: '确认并发送', keep: '继续保留草稿' },
    message: { error: e => { errors.push(e); }, success() {}, warning() {} },
    setBusyId() {}, refresh: async () => {}, hasPendingQuestionAssetVerification: () => false,
    window: {}, relayQuestionAssetsAfterReceipt: async () => {}, cloudDraftSubmissionInput: () => ({ sessionToken: 'test-session' }),
    requireBridge: () => ({ list: async () => { if (readError) throw new Error('READ_FAILED'); return current; },
      confirmAndSubmit: async (...args) => { calls.push(args); return { receipt: { status: 'committed' } }; } }),
  };
  const open = new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  await open(course);
  assert.equal(calls.length, 0, 'opening review must not confirm or submit');
  const markup = renderToStaticMarkup(modal.content);
  assert(markup.includes('物理最新课程') && markup.includes('湖畔新教室') && markup.includes('一并新增地址'), 'review must read the current draft and dependencies instead of stale panel state');
  assert(!markup.includes('物理提高课') && !markup.includes('湖畔教室'));
  await modal.onOk();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [course.id, { sessionToken: 'test-session' }, { items: draftConfirmationSnapshot([freshRoom, freshCourse]) }]);
  for (const state of ['missing', 'completed', 'read-error']) {
    modal = undefined; readError = state === 'read-error';
    current = state === 'missing' ? [] : [{ ...freshCourse, status: 'completed' }];
    await open(course);
    assert.equal(modal, undefined, 'unavailable or no-longer-pending drafts cannot open a stale confirmation');
  }
  assert.equal(errors.length, 3); assert.equal(calls.length, 1);
  // UTF-8: old ID-only delete drafts need an actual cloud record, never a guessed name.
  readError = false;
  const legacy = { id:'legacy-delete',type:'student.delete.v1',status:'awaiting_confirmation',payload:{id:'student',expectedVersion:'version'} };
  current=[legacy]; modal=undefined;
  deps.window.desktopIdentitySessionProvider={listCloudBusinessProjection:async()=>({students:[{id:'student',name:'云端原姓名'}]})};
  await open(legacy);
  assert(renderToStaticMarkup(modal.content).includes('云端原姓名'));
  assert.deepEqual(legacy.payload,{id:'student',expectedVersion:'version'});
  modal=undefined; deps.window.desktopIdentitySessionProvider.listCloudBusinessProjection=async()=>({students:[]});
  await open(legacy); assert.equal(modal,undefined,'unidentified legacy deletes must not offer blind confirmation');
  assert.equal(calls.length,1);
  for(const origin of ['preview','cloud']){
    const record={id:'lesson',course_id:'deleted-course',course_name:'历史课程核验',start_time:'2026-09-10T01:00:00Z',end_time:'2026-09-10T03:00:00Z',room:'原上课地址'};
    const draft={id:'retained-'+origin,type:'schedule.delete.v1',status:'awaiting_confirmation',payload:{id:'lesson',expectedVersion:'version'},...(origin==='preview'?{preview:{record}}:{})};
    current=[draft];modal=undefined;
    deps.window.desktopIdentitySessionProvider.listCloudBusinessProjection=async()=>({courses:[],schedules:origin==='cloud'?[record]:[]});
    const count=calls.length;await open(draft);assert(modal,'retained course name must identify the deletion');
    assert.equal(calls.length,count);const text=renderToStaticMarkup(modal.content);assert(text.includes('历史课程核验')&&text.includes('原上课地址'));
    await modal.onOk();assert.equal(calls.length,count+1);assert.equal(calls.at(-1)[0],draft.id);
  }
  console.log('outbox actual confirmation render and user-action checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
