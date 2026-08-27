'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { stableJson } = require('../shared/authorityProtocol');
const subject = require('./real-question-import-submission');

const TASK_ID = 'question_import_task_960c38c2-2724-4c4e-a8ed-7063b37f12ca';
const ITEM_ID = 'question_import_item_960c38c2_0';
const CONTENT_HASH = 'a'.repeat(64);

function preparedTask(status = 'drafts_prepared') {
  return {
    taskId: TASK_ID, status, phase: status, sourceStorageState: 'verified',
    items: [{
      itemId: ITEM_ID, itemIndex: 0, contentHash: CONTENT_HASH, status: status === 'submitted' ? 'submitted' : 'draft_prepared',
      validation: { status: 'accepted' }, mediaManifest: [],
      candidate: {
        stem: '  质点做匀加速直线运动。  ', question_types: ['single-choice'], options: ['A. 正确', 'B. 错误'],
        answer: 'A', analysis: '  由定义可得。  ', rich_content: { version: 1 }, has_formula: false,
      },
    }],
  };
}

async function main() {
  const record = subject.recordFromPreparedItem({ taskId: TASK_ID, item: preparedTask().items[0] });
  assert.deepStrictEqual(record, {
    id: `question-import-${CONTENT_HASH.slice(0, 40)}`,
    subject: '物理', type: '单选题', difficulty: 3, content: '质点做匀加速直线运动。',
    options: ['A. 正确', 'B. 错误'], answer: 'A', analysis: '由定义可得。', rich_content: { version: 1 },
    knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: {}, has_formula: false,
    import_task_id: TASK_ID, import_item_id: ITEM_ID, import_item_index: 0, import_content_hash: CONTENT_HASH,
  });
  const command = subject.questionCommand({ taskId: TASK_ID, item: preparedTask().items[0] });
  assert.strictEqual(command.type, 'question.create.v1');
  assert.strictEqual(command.commandId, `question-import-${CONTENT_HASH.slice(0, 48)}`);
  assert.strictEqual(command.payloadHash, crypto.createHash('sha256').update(stableJson({ type: command.type, payload: command.payload }), 'utf8').digest('hex'));
  const prepared = subject.commandsForPreparedTask({ task: preparedTask(), taskId: TASK_ID });
  assert.strictEqual(prepared.commands.length, 1, 'all records must be normalized before the first cloud command is sent');

  const calls = [];
  let reads = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true, receipt: { status: 'committed', result: { id: record.id } } }) };
    reads += 1;
    const task = reads === 1 ? preparedTask() : preparedTask('submitted');
    return { ok: true, status: 200, json: async () => ({ ok: true, task }) };
  };
  const result = await subject.submitPreparedTask({ fetchImpl, sessionToken: 'test.ticket', deviceId: 'device-1', baseUrl: 'https://example.test', taskId: TASK_ID });
  assert.deepStrictEqual(result, { taskId: TASK_ID, submittedCount: 1, alreadySubmittedCount: 0, status: 'submitted' });
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(calls[1].url, `https://example.test/api/desktop/question-bank/commands`);
  assert.strictEqual(calls[1].options.headers['x-device-id'], 'device-1');
  assert.strictEqual(JSON.parse(calls[1].options.body).payload.record.import_item_id, ITEM_ID);

  await assert.rejects(
    () => subject.submitPreparedTask({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, task: preparedTask('candidates_ready') }) }), sessionToken: 'test.ticket', deviceId: 'device-1', baseUrl: 'https://example.test', taskId: TASK_ID }),
    error => error?.code === 'REAL_QUESTION_IMPORT_SUBMISSION_NOT_READY',
  );
  console.log('real question import submission tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
