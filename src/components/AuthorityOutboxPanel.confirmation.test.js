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
  let modal; const calls = [];
  const deps = { React, Descriptions, items: [room, course], courseRoomDraftDependencies, draftConfirmationSnapshot,
    draftPresentation: d => describeAuthorityDraft(d), authorityDraftError,
    Modal: { confirm: config => { modal = config; } }, copy: { modalTitle: '确认提交更改', confirm: '确认并发送', keep: '继续保留草稿' },
    message: { error: e => { throw new Error(e); }, success() {}, warning() {} },
    setBusyId() {}, refresh: async () => {}, hasPendingQuestionAssetVerification: () => false,
    window: {}, relayQuestionAssetsAfterReceipt: async () => {}, cloudDraftSubmissionInput: () => ({ sessionToken: 'test-session' }),
    requireBridge: () => ({ confirmAndSubmit: async (...args) => { calls.push(args); return { receipt: { status: 'committed' } }; } }),
  };
  new Function(...Object.keys(deps), compiled)(...Object.values(deps))(course);
  assert.equal(calls.length, 0, 'opening review must not confirm or submit');
  const markup = renderToStaticMarkup(modal.content);
  assert(markup.includes('物理提高课') && markup.includes('湖畔教室') && markup.includes('一并新增地址'));
  await modal.onOk();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [course.id, { sessionToken: 'test-session' }, { items: draftConfirmationSnapshot([room, course]) }]);
  console.log('outbox actual confirmation render and user-action checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
