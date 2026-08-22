const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/browserDatabase.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');
const { applyQuestionSyncRecords, buildBrowserQuestionSearchText, mergeBrowserQuestionUpdate } = require('./questionRichContent.ts');

assert.ok(source.includes('recordAuthorityDraft'), 'browser database should define typed authority draft capture');
assert.ok(source.includes('createAuthorityDraftFromLocalMutation'), 'browser database should use the field-whitelisting typed adapter');
assert.ok(source.includes('listCloudQuestions'), 'cloud question text must join the same authority projection cache as the business projection');
assert.ok(source.includes("storage_state: 'cloud_cached'"), 'cloud question text must be distinguished from locally authored drafts before an edit is captured');
assert.ok(source.includes('window.desktopAuthority.appendDraftSync'), 'typed drafts must be encrypted before a synchronous local edit returns');
assert.ok(source.includes('window.desktopAuthority.appendDraftBatchSync'), 'multi-command edits must append one atomic encrypted draft batch');
assert.ok(
  !/this\.saveData\(\);\s*this\.recordAuthorityDraft(?:Batch)?\(/.test(source),
  'authority drafts must be durably appended before the derived browser cache is saved',
);
assert.ok(!source.includes('sync_engine_sync_pending_changes'), 'browser database must not write raw-row pending changes');
assert.ok(!source.includes('sync_engine_sync_pending_ops'), 'browser database must not write the legacy raw pending queue');
assert.ok(!source.includes('sourceOperationId'), 'browser drafts must not invent legacy raw sync operation ids');

for (const table of [
  'students',
  'courses',
  'schedules',
  'payments',
  'consumptions',
  'teachers',
  'grades',
  'rooms',
  'institutions',
  'assetRecords',
  'assetCategories',
  'questions',
]) {
  assert.ok(source.includes(`this.recordAuthorityDraft('${table}'`), `browser database should queue typed drafts for ${table}`);
}

assert.ok(source.includes(", 'create',"), 'browser database should queue create operations');
assert.ok(source.includes(", 'update',"), 'browser database should queue update operations');
assert.ok(source.includes(", 'delete',"), 'browser database should queue delete operations');
assert.ok(packageJson.includes('src/services/browserDatabaseSyncCapture.test.js'), 'browser database sync capture test should run in npm test');
assert.ok(source.includes('normalizeBrowserQuestionRecord(question as any)'), 'browser records should use the tested pure rich-content normalizer');
assert.ok(source.includes('applyQuestionSyncRecords(map)'), 'incoming desktop sync should use the tested pure apply helper');

const incoming = new Map([['q-1', {
  id: 'q-1', type: 'single', subject: 'physics', difficulty: 3, status: 'draft', content: '', answer: '',
  rich_content: {
    version: 1, type: 'question-document', sections: {
      stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'synced stem' }, { type: 'formula', attrs: { id: 'f-1', canonicalLatex: 'x^2', displayMode: 'inline' } }] }] },
      options: [{ id: 'o-1', label: 'B', isCorrect: true, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sync option needle' }] }] } }],
      subQuestions: [{ id: 's-1', label: '(1)', content: { type: 'doc', content: [] }, answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sync subanswer needle' }] }] } }],
      answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rich answer', marks: [{ type: 'bold' }] }, { type: 'formula', attrs: { id: 'answer-f', canonicalLatex: 'y', displayMode: 'inline' } }] }] }, analysis: { type: 'doc', content: [] },
    },
  },
}]]);
const applied = applyQuestionSyncRecords(incoming);
const persisted = JSON.parse(JSON.stringify(applied));
const reloaded = applyQuestionSyncRecords(new Map(persisted.map(record => [record.id, record])));
assert.strictEqual(reloaded[0].rich_content.sections.stem.content[0].content[1].attrs.canonicalLatex, 'x^2');
assert.strictEqual(reloaded[0].content, 'synced stem x^2');
assert.strictEqual(reloaded[0].has_formula, true);
assert.strictEqual(reloaded[0].search_text, 'synced stem x^2 B sync option needle (1) sync subanswer needle rich answer y');
assert.ok(buildBrowserQuestionSearchText(reloaded[0]).includes('sync option needle'));
assert.ok(buildBrowserQuestionSearchText(reloaded[0]).includes('sync subanswer needle'));
assert.throws(() => applyQuestionSyncRecords(new Map([['bad', { ...incoming.get('q-1'), id: 'bad', rich_content: { version: 1, type: 'question-document', sections: { stem: { type: 'doc', content: [{ type: 'script' }] }, options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] } } } }]])), /unsupported node/);
const legacyEdited = mergeBrowserQuestionUpdate(reloaded[0], { content: 'local old-client edit' });
const richAnswerBefore = JSON.parse(JSON.stringify(reloaded[0].rich_content.sections.answer));
assert.strictEqual(legacyEdited.content, 'local old-client edit');
assert.strictEqual(legacyEdited.rich_content.sections.stem.content[0].content[0].text, 'local old-client edit');
assert.deepStrictEqual(legacyEdited.rich_content.sections.answer, richAnswerBefore);
const metadataEdited = mergeBrowserQuestionUpdate(legacyEdited, { difficulty: 5 });
assert.deepStrictEqual(metadataEdited.rich_content, legacyEdited.rich_content);
const optionEdited = mergeBrowserQuestionUpdate(metadataEdited, { options: [{ label: 'C', content: 'old option edit', is_correct: true }] });
assert.strictEqual(optionEdited.rich_content.sections.options[0].isCorrect, true);
assert.ok(source.includes('mergeBrowserQuestionUpdate(this.data.questions[idx], provenanceSafeUpdates as any) as unknown as Question'), 'local browser updates should use the tested split-brain-safe merge helper');
assert.ok(source.includes('buildBrowserQuestionSearchText(question)'), 'production browser search index should consume normalized search_text');
const existingRecords = [{ id: 'keep', rich_content: reloaded[0].rich_content }];
const snapshot = JSON.parse(JSON.stringify(existingRecords));
assert.throws(() => applyQuestionSyncRecords(new Map([
  ['valid', incoming.get('q-1')],
  ['invalid', { ...incoming.get('q-1'), id: 'invalid', rich_content: { version: 1, type: 'question-document', sections: { stem: { type: 'doc', content: [] }, options: [{ id: 'bad', label: 'A', isCorrect: false, content: { type: 'paragraph', content: [] } }], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] } } } }],
]), existingRecords), /option content must be a doc/);
assert.deepStrictEqual(existingRecords, snapshot, 'atomic sync rejection must not mutate existing records');

console.log('browserDatabase sync capture checks passed');
