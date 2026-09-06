const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/browserDatabase.ts', 'utf-8');
const personalAssetsSource = fs.readFileSync('src/pages/PersonalAssets.tsx', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');
const { applyQuestionSyncRecords, buildBrowserQuestionSearchText, mergeBrowserQuestionUpdate } = require('./questionRichContent.ts');

assert.ok(source.includes('recordAuthorityDraft'), 'browser database should define typed authority draft capture');
assert.ok(source.includes('createAuthorityDraftFromLocalMutation'), 'browser database should use the field-whitelisting typed adapter');
assert.ok(source.includes('listCloudQuestions'), 'cloud question text must join the same authority projection cache as the business projection');
assert.ok(source.includes("storage_state: 'cloud_cached'"), 'cloud question text must be distinguished from locally authored drafts before an edit is captured');
assert.ok(source.includes('deleteCloudCachedQuestion'), 'cloud-cached question deletes must be captured as typed encrypted drafts');
assert.ok(source.includes("collection === 'questions'") && source.includes('value.version'),
  'cloud question update/delete drafts must capture the integer content version returned by the question list');
const restoreQuestionVersionSource = source.match(/restoreQuestionVersion\(questionId: string, versionId: string\): Question \| null \{[\s\S]*?\n  \}/)?.[0] || '';
assert.ok(restoreQuestionVersionSource.includes('const currentVersion = this.data.questions[idx].version ?? null'),
  'question history restore must capture the current cloud CAS version before replacing the record');
assert.ok(restoreQuestionVersionSource.includes('version: currentVersion ?? undefined'),
  'question history restore must not revive the historical snapshot version');
assert.ok(restoreQuestionVersionSource.includes("this.recordAuthorityDraft('questions', 'update', questionId, this.data.questions[idx], currentVersion)"),
  'question history restore must explicitly submit the current cloud CAS version as expectedVersion');
assert.ok(source.includes('window.desktopAuthority.appendDraftSync'), 'typed drafts must be encrypted before a synchronous local edit returns');
assert.ok(source.includes('window.desktopAuthority.appendDraftBatchSync'), 'multi-command edits must append one atomic encrypted draft batch');
assert.ok(source.includes('authorityCacheCheckpoint.guard'), 'failed draft persistence must restore the last durable derived-cache checkpoint');
assert.ok(
  !/this\.saveData\(\);\s*this\.recordAuthorityDraft(?:Batch)?\(/.test(source),
  'authority drafts must be durably appended before the derived browser cache is saved',
);
assert.ok(!source.includes('sync_engine_sync_pending_changes'), 'browser database must not write raw-row pending changes');
assert.ok(!source.includes('sync_engine_sync_pending_ops'), 'browser database must not write the legacy raw pending queue');
assert.ok(!source.includes('sourceOperationId'), 'browser drafts must not invent legacy raw sync operation ids');
assert.ok(!source.includes("{id:'builtin-tuition'"),
  'browser cache must not manufacture local asset-category business data');
assert.ok(!source.includes("id.startsWith('builtin-')"),
  'legacy local asset categories must not receive special authority-exempt behavior');
assert.ok(!personalAssetsSource.includes("'builtin-other-income'"),
  'asset imports must not target a locally seeded income category');
assert.ok(!personalAssetsSource.includes("'builtin-other-expense'"),
  'asset imports must not target a locally seeded expense category');
assert.ok(personalAssetsSource.includes('createAssetCategory'),
  'asset imports must create an ordinary confirmation draft category when required');

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
  'schools',
  'assetRecords',
  'assetCategories',
  'questions',
]) {
  assert.ok(source.includes(`this.recordAuthorityDraft('${table}'`), `browser database should queue typed drafts for ${table}`);
}

const syncTablesMatch = source.match(/const SYNC_TABLES: SyncTable\[\] = \[([\s\S]*?)\];/);
assert.ok(syncTablesMatch, 'browser database should declare the authority projection sync table list');
for (const table of [
  'students', 'courses', 'schedules', 'payments', 'consumptions', 'teachers',
  'grades', 'rooms', 'institutions', 'schools', 'assetRecords', 'assetCategories',
]) {
  assert.ok(syncTablesMatch[1].includes(`'${table}'`),
    `authority projection refresh must include ${table} after a confirmed cloud command`);
}

assert.ok(source.includes(", 'create',"), 'browser database should queue create operations');
assert.ok(source.includes(", 'update',"), 'browser database should queue update operations');
assert.ok(source.includes(", 'delete',"), 'browser database should queue delete operations');
for (const marker of [
  "this.recordAuthorityDraft('rooms', 'update', id, this.data.rooms[index], baseVersion)",
  "this.recordAuthorityDraft('rooms', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('students', 'update', id, draftValue, baseVersion)",
  "this.recordAuthorityDraft('students', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('courses', 'update', id, this.data.courses[index], baseVersion)",
  "this.recordAuthorityDraft('courses', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('schedules', 'update', id, this.data.schedules[index], baseVersion)",
  "this.recordAuthorityDraft('schedules', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('teachers', 'update', id, this.data.teachers[index], baseVersion)",
  "this.recordAuthorityDraft('teachers', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('institutions', 'update', id, this.data.institutions[index], baseVersion)",
  "this.recordAuthorityDraft('institutions', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('schools', 'update', id, this.data.schools[index], baseVersion)",
  "this.recordAuthorityDraft('schools', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('payments', 'update', id, this.data.payments[index], baseVersion)",
  "this.recordAuthorityDraft('payments', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('consumptions', 'update', id, this.data.consumptions[index], baseVersion)",
  "this.recordAuthorityDraft('consumptions', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('assetRecords', 'update', id, this.data.assetRecords[idx], baseVersion)",
  "this.recordAuthorityDraft('assetRecords', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('assetCategories', 'delete', id, { id }, baseVersion)",
  "this.recordAuthorityDraft('grades', 'delete', id, { id }, baseVersion)",
  "}, current.updated_at || null)",
  "}, system.updated_at || null)",
  "}, current?.updated_at || null)",
  "}, root?.updated_at || null)",
]) {
  assert.ok(source.includes(marker), `cloud business update/delete must capture the observed updated_at baseline: ${marker}`);
}
assert.ok(source.includes('baseVersion: previous.updated_at || null'),
  'schedule replacement drafts must preserve each prior record version');
assert.ok(source.includes('contacts: this.studentAuthorityContacts(updated)'),
  'offline student update drafts must include observed contact versions for the atomic cloud record contract');
assert.ok(source.includes('this.data.student_contacts = overlayStudentContactDraftProjection(updated, this.data.student_contacts || [])'),
  'offline student updates must overlay the derived contact cache after recording the versioned cloud draft');
assert.ok(source.includes('contacts: this.studentAuthorityContacts(newStudent)'),
  'offline student creation drafts must include all three editable contact slots');
assert.ok(source.includes('primaryPhone || primaryWechat || primary'),
  'clearing an observed primary contact must remain a versioned unbind draft instead of disappearing');
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
