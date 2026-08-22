'use strict';

const assert = require('assert');

const { createQuestionAuthorityService } = require('./questionAuthorityService');

async function main() {
  const calls = [];
  const service = createQuestionAuthorityService({
    query: async (text, values) => {
      calls.push([text, values]);
      return { rows: [{ id: 'question-1', status: 'draft', version: 1, contentHash: 'a'.repeat(64) }] };
    },
  });
  const created = await service.create({
    tenantId: 'default',
    actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    question: {
      id: 'question-1', subject: 'physics', questionType: 'single_choice', difficulty: 3,
      stem: 'What is the unit of force?', answer: 'newton', explanation: null,
      options: ['N', 'J'], richContent: null, taxonomy: { chapter: 'mechanics' }, hasFormula: false,
    },
  });
  assert.deepStrictEqual(created, { id: 'question-1', status: 'draft', version: 1, contentHash: 'a'.repeat(64) });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0][0].includes('INSERT INTO business.questions') && calls[0][0].includes('INSERT INTO business.question_contents'));
  assert.ok(calls[0][0].includes('created_by_account_id'));
  assert.strictEqual(calls[0][1][0], 'question-1');
  assert.strictEqual(calls[0][1][1], 'default');
  assert.strictEqual(calls[0][1][5], 'teacher-account-1');
  assert.ok(!calls[0][0].match(/oss_url|file_path|data_url|storage_state/iu), 'the text command must not revive local or object-byte authority fields');

  await assert.rejects(
    () => service.create({ tenantId: 'default', actor: { accountId: 'student-account-1', roles: ['student'] }, question: {
      id: 'question-2', subject: 'physics', questionType: 'single_choice', difficulty: 3,
      stem: 'Blocked', answer: null, explanation: null, options: [], richContent: null, taxonomy: {}, hasFormula: false,
    } }),
    /CLOUD_QUESTION_ACCESS_DENIED/
  );
}

main().then(() => console.log('cloud question authority service checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
