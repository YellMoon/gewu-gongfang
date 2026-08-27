'use strict';

const assert = require('assert');
const {
  importSource,
  waitForCandidates,
  taskEvidence,
} = require('./real-question-import-acceptance');

assert.deepStrictEqual(importSource('exam', '/tmp/exam.docx'), {
  sourceType: 'exam',
  sourcePath: '/tmp/exam.docx',
  sourceFileName: 'exam.docx',
  sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
assert.throws(() => importSource('exam', '/tmp/not-word.pdf'), /REAL_QUESTION_IMPORT_SOURCE_INVALID/);

(async () => {
  const statuses = [
    { taskId: 'question_import_task_abcdefgh', status: 'queued_for_parse', phase: 'queued_for_parse' },
    { taskId: 'question_import_task_abcdefgh', status: 'candidates_ready', phase: 'candidates_ready', items: [{ itemId: 'question_import_item_abcdefgh', itemIndex: 0, contentHash: 'a'.repeat(64), candidate: { stem: 'x' }, validation: { status: 'accepted' }, mediaManifest: [] }] },
  ];
  const ready = await waitForCandidates({ read: async () => statuses.shift(), sleep: async () => {}, attempts: 2 });
  assert.strictEqual(ready.status, 'candidates_ready');
  assert.deepStrictEqual(taskEvidence(ready), { taskId: 'question_import_task_abcdefgh', status: 'candidates_ready', phase: 'candidates_ready', itemCount: 1, acceptedOrWarningCount: 1 });
  await assert.rejects(
    () => waitForCandidates({ read: async () => ({ taskId: 'question_import_task_abcdefgh', status: 'failed', phase: 'failed' }), sleep: async () => {}, attempts: 1 }),
    /REAL_QUESTION_IMPORT_TASK_FAILED/,
  );
  console.log('real question import acceptance checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
