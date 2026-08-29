'use strict';

const assert = require('assert');
const { changesForPublishedQuestion, questionPublishCommand, importedQuestionIds } = require('./real-question-import-publish');

const question = Object.freeze({
  id: 'question-import-abc', subject: '物理', type: '单选题', difficulty: 3,
  content: '题干', options: ['A', 'B'], answer: 'A', analysis: '解析', rich_content: null,
  knowledge_point_ids: ['kp-1'], model_point_ids: [], taxonomy_ids: { system: ['node'] }, has_formula: false, status: 'draft',
});

const changes = changesForPublishedQuestion(question);
const { id: _id, ...questionChanges } = question;
assert.deepStrictEqual(changes, { ...questionChanges, status: 'published' });
assert.ok(!Object.hasOwn(changes, 'id'), 'an update changes payload must not smuggle a second record id');

const command = questionPublishCommand(question);
assert.strictEqual(command.type, 'question.update.v1');
assert.deepStrictEqual(command.payload, { id: question.id, changes: { ...changes } });
assert.match(command.commandId, /^question-publish-[a-z0-9-]+$/);
assert.match(command.payloadHash, /^[0-9a-f]{64}$/);

assert.deepStrictEqual(importedQuestionIds({ items: [{ contentHash: 'a'.repeat(64) }, { contentHash: 'b'.repeat(64) }] }), [
  `question-import-${'a'.repeat(40)}`, `question-import-${'b'.repeat(40)}`,
]);
assert.throws(() => importedQuestionIds({ items: [{ contentHash: 'not-a-hash' }] }), /REAL_QUESTION_IMPORT_PUBLISH_TASK_INVALID/);

console.log('real question import publish helper checks passed');
