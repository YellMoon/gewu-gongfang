'use strict';

const assert = require('assert');
const {
  changesForPublishedQuestion, importedQuestionIds, questionCreateCommand, questionPublishCommand,
  questionRecordFromImportItem,
} = require('./real-question-import-publish');

const question = Object.freeze({
  id: 'question-import-abc', subject: '物理', type: '单选题', difficulty: 3,
  content: '题干', options: ['A', 'B'], answer: 'A', analysis: '解析', rich_content: null,
  knowledge_point_ids: ['kp-1'], model_point_ids: [], taxonomy_ids: { system: ['node'] }, has_formula: false, status: 'draft', version: 3,
});

const changes = changesForPublishedQuestion(question);
const { id: _id, version: _version, ...questionChanges } = question;
assert.deepStrictEqual(changes, { ...questionChanges, status: 'published' });
assert.ok(!Object.hasOwn(changes, 'id'), 'an update changes payload must not smuggle a second record id');

const command = questionPublishCommand(question);
assert.strictEqual(command.type, 'question.update.v1');
assert.deepStrictEqual(command.payload, { id: question.id, expectedVersion: 3, changes: { ...changes } });
assert.match(command.commandId, /^question-publish-[a-z0-9-]+$/);
assert.match(command.payloadHash, /^[0-9a-f]{64}$/);
assert.throws(() => questionPublishCommand({ ...question, version: undefined }), /REAL_QUESTION_IMPORT_PUBLISH_QUESTION_INVALID/);

assert.deepStrictEqual(importedQuestionIds({ items: [{ contentHash: 'a'.repeat(64) }, { contentHash: 'b'.repeat(64) }] }), [
  `question-import-${'a'.repeat(40)}`, `question-import-${'b'.repeat(40)}`,
]);
assert.throws(() => importedQuestionIds({ items: [{ contentHash: 'not-a-hash' }] }), /REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID/);

const imported = questionRecordFromImportItem('question_import_task_demo', {
  itemId: 'question_import_item_demo_0', itemIndex: 0, contentHash: 'c'.repeat(64),
  candidate: { stem: 'Imported stem', question_types: ['multiple-choice'], options: ['A', 'B'], answer: 'AB', analysis: 'Imported analysis', rich_content: null, has_formula: true },
});
assert.deepStrictEqual(imported, {
  id: `question-import-${'c'.repeat(40)}`, subject: '\u7269\u7406', type: '\u591a\u9009\u9898', difficulty: 3,
  content: 'Imported stem', options: ['A', 'B'], answer: 'AB', analysis: 'Imported analysis', rich_content: null,
  knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: {}, has_formula: true,
  import_task_id: 'question_import_task_demo', import_item_id: 'question_import_item_demo_0', import_item_index: 0, import_content_hash: 'c'.repeat(64),
});
const importedCommand = questionCreateCommand(imported);
assert.strictEqual(importedCommand.type, 'question.create.v1');
assert.deepStrictEqual(importedCommand.payload, { record: imported });
assert.match(importedCommand.payloadHash, /^[0-9a-f]{64}$/);
assert.throws(() => questionRecordFromImportItem('question_import_task_demo', { itemId: 'question_import_item_demo_0', itemIndex: 0, contentHash: 'd'.repeat(64), candidate: { question_types: ['single'] } }), /REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID/);

console.log('real question import publish helper checks passed');
