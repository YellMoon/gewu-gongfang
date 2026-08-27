'use strict';

const assert = require('assert');
const { createPaperExportTaskRepository } = require('./paperExportTaskRepository');

(async () => {
  const calls = [];
  const repository = createPaperExportTaskRepository({
    randomId: () => 'paper-task-1',
    query: async (text, values) => {
      calls.push([text, values]);
      if (text.includes("phase='media_pending'")) return { rows: [{ taskId: 'paper-task-1', status: 'processing', phase: 'media_pending', progress: 20, requestHash: 'b'.repeat(64), createdAt: new Date('2026-08-23T00:00:00.000Z'), updatedAt: new Date('2026-08-23T00:00:00.000Z') }] };
      if (text.includes('FROM business.paper_export_tasks')) return { rows: [] };
      if (text.includes('FROM business.questions')) {
        return { rows: values[1][0] === 'question-1' ? [
          { id: 'question-1', subject: 'physics', questionType: 'single', difficulty: 2, stem: 's1', answer: 'a1', explanation: null, options: [], richContent: null, hasFormula: false, contentHash: 'a'.repeat(64), version: 1, assets: [{ assetKey: 'b'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png', assetType: 'image' }, { assetKey: 'c'.repeat(64), fileName: 'formula.svg', mimeType: 'image/png', assetType: 'formula_preview' }] },
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
    request: { questionIds: ['question-1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native', layout: { items: [{ id: 'question-1', sectionTitle: 'Part one', score: 3 }] } },
  });
  await assert.rejects(
    () => repository.create({ tenantId: 'default', actor: { accountId: 'student-1', roles: ['student'] }, idempotencyKey: 'student-export', taskType: 'paper-export-pdf', request: { questionIds: ['q1'], title: 'Paper', subject: 'math', answerPosition: 'end', formulaMode: 'latex-vector' } }),
    /CLOUD_PAPER_EXPORT_ACCESS_DENIED/,
    'student identities may preview published questions but cannot create export tasks',
  );
  assert.strictEqual(created.taskId, 'paper-task-1');
  assert.strictEqual(created.status, 'queued');
  assert.strictEqual(created.phase, 'queued');
  assert.strictEqual(created.progress, 0);
  assert.strictEqual(created.replayed, false);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls[1][0].includes('FROM business.questions'));
  assert.ok(calls[1][0].includes('array_position'), 'question snapshots must preserve the order selected in the paper editor');
  assert.ok(calls[1][0].includes('business.question_assets') && calls[1][0].includes("asset.state='verified'"), 'paper snapshots must freeze only verified question media descriptors');
  assert.ok(calls[1][0].includes("asset.asset_type IN ('image','formula_preview')"), 'formula preview media must be frozen with the selected paper instead of being silently omitted');
  assert.ok(calls[1][0].includes("asset.mime_type IN ('image/png','image/jpeg','image/jpg')"), 'paper snapshots must not misclassify OLE or opaque binary objects as exportable images');
  assert.ok(calls[2][0].includes('INSERT INTO business.paper_export_tasks'));
  const deferred = await repository.defer({ taskId: 'paper-task-1' });
  assert.strictEqual(deferred.phase, 'media_pending');
  await assert.rejects(() => repository.create({
    tenantId: 'default', actor: { accountId: 'account-1', roles: ['teacher'] }, idempotencyKey: 'export-2',
    taskType: 'paper-export-pdf', request: { questionIds: ['missing'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native' },
  }), /CLOUD_PAPER_EXPORT_SELECTION_INVALID/);
  await assert.rejects(() => repository.create({
    tenantId: 'default', actor: { accountId: 'account-1', roles: ['teacher'] }, idempotencyKey: 'export-layout-invalid',
    taskType: 'paper-export-pdf', request: { questionIds: ['question-1'], title: 'paper', subject: 'physics', answerPosition: 'after', formulaMode: 'word-native', layout: { items: [{ id: 'other-question', sectionTitle: 'Part one', score: 3 }] } },
  }), /CLOUD_PAPER_EXPORT_INPUT_INVALID/);
  console.log('paper export task repository checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
