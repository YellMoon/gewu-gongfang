'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createQuestionAuthorityService } = require('./questionAuthorityService');
const { stableJson } = require('../../shared/authorityProtocol');

async function main() {
  const calls = [];
  const receipts = new Map();
  const service = createQuestionAuthorityService({
    query: async (text, values) => {
      calls.push([text, values]);
      if (text.includes('FROM business.desktop_question_command_receipts')) {
        const receipt = receipts.get(`${values[0]}:${values[1]}`);
        return { rows: receipt ? [receipt] : [] };
      }
      if (text.includes('INSERT INTO business.desktop_question_command_receipts')) {
        receipts.set(`${values[0]}:${values[1]}`, {
          payloadHash: values[2], status: values[3], result: JSON.parse(values[4]), resultHash: values[5],
        });
        return { rows: [] };
      }
      if (text.includes('FROM business.questions q')) {
        return { rows: [{
          id: 'question-1', subject: 'physics', type: 'single_choice', difficulty: 3, status: 'draft',
          content: 'Cloud text', options: ['A'], answer: 'answer', analysis: 'analysis', rich_content: null,
          taxonomy: { knowledgePointIds: [], modelPointIds: [], taxonomyIds: [] }, has_formula: false, version: 1,
        }] };
      }
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

  const listed = await service.list({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] }, limit: 200,
  });
  assert.deepStrictEqual(listed, [{
    id: 'question-1', subject: 'physics', type: 'single_choice', difficulty: 3, status: 'draft',
    content: 'Cloud text', options: ['A'], answer: 'answer', analysis: 'analysis', rich_content: null,
    knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: false, version: 1,
  }]);
  assert.ok(calls.some(call => call[0].includes('FROM business.questions q') && call[0].includes('business.question_contents c')),
    'the question list must read cloud structured text only from the cloud authority tables');

  const commandPayload = {
    record: {
      id: 'question-3', subject: 'physics', type: 'single_choice', difficulty: 3,
      content: 'Cloud is authoritative', options: [], answer: 'yes', analysis: '',
      knowledge_point_ids: ['kp-1'], model_point_ids: [], taxonomy_ids: [], has_formula: false,
    },
  };
  const commandPayloadHash = crypto.createHash('sha256')
    .update(stableJson({ type: 'question.create.v1', payload: commandPayload }), 'utf8').digest('hex');
  const receipt = await service.submitDesktopDraft({
    tenantId: 'default',
    actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-1',
      payloadHash: commandPayloadHash,
      type: 'question.create.v1',
      payload: commandPayload,
    },
  });
  assert.deepStrictEqual(receipt, {
    commandId: 'question-command-1', payloadHash: commandPayloadHash, status: 'committed',
    result: { id: 'question-1', status: 'draft', version: 1, contentHash: 'a'.repeat(64) },
    resultHash: receipt.resultHash,
  });
  assert.match(receipt.resultHash, /^[0-9a-f]{64}$/);
  assert.ok(!calls.some(call => call[0].match(/storage_state|file_path|data_url|oss_url/iu)));
  const replayedReceipt = await service.submitDesktopDraft({
    tenantId: 'default',
    actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-1', payloadHash: commandPayloadHash,
      type: 'question.create.v1', payload: commandPayload,
    },
  });
  assert.deepStrictEqual(replayedReceipt, receipt, 'a retry must return the original cloud receipt without a second question write');
  assert.strictEqual(calls.filter(call => call[0].includes('INSERT INTO business.questions')).length, 2,
    'the initial direct-create test and one command create are the only question inserts');

  const updatePayload = {
    id: 'question-3',
    changes: {
      subject: 'physics', type: 'single_choice', difficulty: 4,
      content: 'Cloud update is authoritative', options: [], answer: 'updated', analysis: '',
      knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: true,
    },
  };
  const updateReceipt = await service.submitDesktopDraft({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-2', type: 'question.update.v1', payload: updatePayload,
      payloadHash: crypto.createHash('sha256').update(stableJson({ type: 'question.update.v1', payload: updatePayload }), 'utf8').digest('hex'),
    },
  });
  assert.strictEqual(updateReceipt.status, 'committed');
  assert.ok(calls.some(call => call[0].includes('UPDATE business.questions') && call[0].includes('UPDATE business.question_contents')));

  const deletePayload = { id: 'question-3' };
  const deleteReceipt = await service.submitDesktopDraft({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-3', type: 'question.delete.v1', payload: deletePayload,
      payloadHash: crypto.createHash('sha256').update(stableJson({ type: 'question.delete.v1', payload: deletePayload }), 'utf8').digest('hex'),
    },
  });
  assert.strictEqual(deleteReceipt.status, 'committed');
  assert.ok(calls.some(call => call[0].includes('deleted=true') && call[0].includes('business.question_contents')));

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
