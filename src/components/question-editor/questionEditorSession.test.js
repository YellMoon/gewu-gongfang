const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const ts = require('typescript');

const filename = require.resolve('./questionEditorSession.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = new Module(filename); loaded._compile(compiled, filename);
const { shouldProtectEditorExit, runQuestionEditorSave, nextDirtyState, persistRemoteThenLocal, registerEditorSpaExitGuard, confirmEditorSpaExit, createQuestionEditorSaveGate, requestEditorSpaNavigation, mergeImportedQuestionMetadata, createRichDocumentDirtyCoordinator } = loaded.exports;

for (const page of ['QuestionBankEdit.tsx', 'QuestionBankPreview.tsx', 'QuestionBankImport.tsx']) {
  const source = fs.readFileSync(require.resolve(`../../pages/${page}`), 'utf8');
  assert.ok(source.includes('<QuestionStructureEditor'), `${page} must render the canonical structure editor`);
  assert.ok(source.includes('createQuestionEditorSaveGate') && source.includes('saveGate'), `${page} must use the tested exclusive save coordinator`);
  assert.ok(source.includes('createRichDocumentDirtyCoordinator') && source.includes('updateRichDocument'), `${page} must compare rich editor echoes with the opening baseline`);
  assert.ok(source.includes('richDirtyCoordinator.markSaved'), `${page} must advance the rich baseline after save`);
  assert.ok(!source.includes('onChange={next => { setRichDocument(next); setEditorDirty(true); }}'), `${page} must not mark controlled rich echoes dirty`);
  assert.ok(source.includes('shouldProtectEditorExit'), `${page} must use the tested dirty-exit guard`);
  assert.ok(!source.includes('name="formulas"'), `${page} must not expose a duplicate formula textarea`);
  for (const legacyField of ['content', 'options', 'answer', 'analysis']) {
    assert.ok(!source.includes(`name="${legacyField}"`), `${page} must not render duplicate ${legacyField} controls`);
  }
}
const appSource = fs.readFileSync(require.resolve('../../App.tsx'), 'utf8');
assert.ok((appSource.match(/requestEditorSpaNavigation/g) || []).length >= 3, 'custom events and direct AppShell navigation must share the guarded coordinator');
const importSource = fs.readFileSync(require.resolve('../../pages/QuestionBankImport.tsx'), 'utf8');
assert.ok(importSource.includes('onClick={() => openImportedQuestionEditor(row)}'), 'parsed import rows must expose the real structure editor');
const editSource = fs.readFileSync(require.resolve('../../pages/QuestionBankEdit.tsx'), 'utf8');
assert.ok(editSource.includes('Modal.useModal()') && editSource.includes('modalApi.confirm('), 'dirty confirmation must use the contextual modal API without console errors');

assert.strictEqual(nextDirtyState(true, 'load'), false);
assert.strictEqual(nextDirtyState(false, 'change'), true);
assert.strictEqual(nextDirtyState(true, 'save-failure'), true);
assert.strictEqual(nextDirtyState(true, 'save-success'), false);
assert.strictEqual(shouldProtectEditorExit(true, true), true);
assert.strictEqual(shouldProtectEditorExit(false, true), false);
const unregisterClean = registerEditorSpaExitGuard(() => false);
assert.strictEqual(confirmEditorSpaExit(() => { throw new Error('clean navigation must not confirm'); }), true);
unregisterClean();
const unregisterDirty = registerEditorSpaExitGuard(() => true);
assert.strictEqual(confirmEditorSpaExit(() => false), false);
assert.strictEqual(confirmEditorSpaExit(() => true), true);
let navigations = 0;
assert.strictEqual(requestEditorSpaNavigation(() => { navigations += 1; }, () => false), false);
assert.strictEqual(navigations, 0);
assert.strictEqual(requestEditorSpaNavigation(() => { navigations += 1; }, () => true), true);
assert.strictEqual(navigations, 1);
assert.deepStrictEqual(mergeImportedQuestionMetadata({ content: 'old', assets: ['a'], parser_warning: 'keep', unknown: 7 }, { content: 'new' }), { content: 'new', assets: ['a'], parser_warning: 'keep', unknown: 7 });
unregisterDirty();

const baselineRich = { version: 1, type: 'question-document', sections: { stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'seed' }] }] }, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } };
const richDirty = createRichDocumentDirtyCoordinator(baselineRich);
const openedVersion = richDirty.snapshot().version;
assert.strictEqual(richDirty.update(JSON.parse(JSON.stringify(baselineRich))).dirty, false, 'TipTap hydration clone must stay clean');
assert.strictEqual(richDirty.snapshot().version, openedVersion, 'controlled echo must not create a content version');
const reorderedObjectKeys = { type: 'question-document', sections: baselineRich.sections, version: 1 };
assert.strictEqual(richDirty.update(reorderedObjectKeys).dirty, false, 'object key order is not a user edit');
const userTextEdit = JSON.parse(JSON.stringify(baselineRich));
userTextEdit.sections.stem.content[0].content[0].text = 'changed';
assert.strictEqual(richDirty.update(userTextEdit).dirty, true, 'user text edit must become dirty');
assert.strictEqual(richDirty.update(JSON.parse(JSON.stringify(userTextEdit))).changed, false, 'controlled edit echo must be suppressed');
const reorderedOptions = JSON.parse(JSON.stringify(baselineRich));
reorderedOptions.sections.options.reverse();
assert.strictEqual(richDirty.update(reorderedOptions).dirty, true, 'user reorder must become dirty');
assert.strictEqual(richDirty.update(baselineRich).dirty, false, 'reverting to the opening baseline must become clean');
richDirty.update(userTextEdit);
assert.strictEqual(richDirty.markSaved().dirty, false, 'successful save must advance the baseline');
assert.strictEqual(richDirty.update(JSON.parse(JSON.stringify(userTextEdit))).dirty, false, 'post-save controlled echo must stay clean');

let attempts = 0;
(async () => {
  const first = await runQuestionEditorSave(async () => { attempts += 1; throw new Error('offline'); });
  assert.strictEqual(first.ok, false);
  const retry = await runQuestionEditorSave(async () => { attempts += 1; });
  assert.strictEqual(retry.ok, true);
  assert.strictEqual(attempts, 2);
  let localWrites = 0;
  await assert.rejects(() => persistRemoteThenLocal(async () => ({ ok: false, json: async () => ({ success: false, error: 'denied' }) }), () => { localWrites += 1; }), /denied/);
  await assert.rejects(() => persistRemoteThenLocal(async () => ({ ok: true, json: async () => ({ success: false, error: 'rejected' }) }), () => { localWrites += 1; }), /rejected/);
  assert.strictEqual(localWrites, 0, 'remote failure must not fork local state');
  await persistRemoteThenLocal(async () => ({ ok: true, json: async () => ({ success: true }) }), () => { localWrites += 1; });
  assert.strictEqual(localWrites, 1);
  const gate = createQuestionEditorSaveGate();
  let saving = false;
  let release;
  const clickSave = async (save) => { saving = true; const result = await gate(save); if (result.owned) saving = false; return result; };
  const pending = clickSave(() => new Promise(resolve => { release = resolve; }));
  assert.strictEqual(saving, true);
  const duplicate = await clickSave(async () => {});
  assert.strictEqual(duplicate.ok, false);
  assert.strictEqual(duplicate.owned, false);
  assert.match(duplicate.error.message, /SAVE_IN_PROGRESS/);
  assert.strictEqual(saving, true, 'duplicate click must not enable editors while owner is pending');
  release(); const owner = await pending;
  assert.strictEqual(owner.owned, true);
  assert.strictEqual(saving, false);
  console.log('question editor session behavior tests passed');
})();
