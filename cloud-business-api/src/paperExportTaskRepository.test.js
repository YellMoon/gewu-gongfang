'use strict';

const assert = require('assert');
const { createPaperExportTaskRepository } = require('./paperExportTaskRepository');

(async () => {
  const calls = [];
  const repository = createPaperExportTaskRepository({
    randomId: () => 'paper-task-1',
    query: async (text, values) => {
      calls.push([text, values]);
      if (text.includes('FROM business.paper_export_tasks')) return { rows: [] };
      if (text.includes('FROM business.questions')) {
        return { rows: values[1][0] === 'question-1' ? [
          { id: 'question-1', subject: 'physics', questionType: 'single', difficulty: 2, stem: 's1', answer: 'a1', explanation: null, options: [], richContent: null, hasFormula: false, contentHash: 'a'.repeat(64), version: 1 },
        ] : [] };
      }
      if (text.includes('INSERT INTO business.paper_export_tasks')) {
        return { rows: [{ taskId: 'paper-task-1', status: 'queued', phase: 'queued', progress: 0, requestHash: 'b'.repeat(64), createdAt: new Date('2026-08-23T00:00:00.000Z'), updatedAt: new Date('2026-08-23T00:00:00.000Z') }] };
      }
      throw new Error('unexpected query');
    },
  });
  const created = await repository.create({
    tenantId: 'default',
    actor: { accountId: 'account-1', roles: ['teacher'] },
    idempotencyKey: 'export-1',
    taskType: 'paper-export-pdf',
    request: { questionIds: ['question-1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' },
  });
  assert.strictEqual(created.taskId, 'paper-task-1');
  assert.strictEqual(created.status, 'queued');
  assert.strictEqual(created.phase, 'queued');
  assert.strictEqual(created.progress, 0);
  assert.strictEqual(created.replayed, false);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls[1][0].includes('FROM business.questions'));
  assert.ok(calls[2][0].includes('INSERT INTO business.paper_export_tasks'));
  await assert.rejects(() => repository.create({
    tenantId: 'default', actor: { accountId: 'account-1', roles: ['teacher'] }, idempotencyKey: 'export-2',
    taskType: 'paper-export-pdf', request: { questionIds: ['missing'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' },
  }), /CLOUD_PAPER_EXPORT_SELECTION_INVALID/);
  console.log('paper export task repository checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
