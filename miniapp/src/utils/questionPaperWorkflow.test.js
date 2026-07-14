const assert = require('assert');
const workflow = require('./questionPaperWorkflow');

const selection = workflow.toggleOrderedSelection([], 'q2');
assert.deepStrictEqual(workflow.toggleOrderedSelection(selection, 'q1'), ['q2', 'q1']);
assert.deepStrictEqual(workflow.toggleOrderedSelection(['q2', 'q1'], 'q2'), ['q1']);

const draft = workflow.createTaskDraft({ taskType: 'paper-export-pdf', questionIds: ['q2', 'q1'], title: 'Paper', answerPosition: 'after-each', formulaMode: 'latex-vector', targetHostDeviceId: 'host-a' }, { now: 100, idFactory: () => 'idem-1' });
assert.deepStrictEqual(draft.request, {
  protocolVersion: 2, taskType: 'paper-export-pdf', targetHostDeviceId: 'host-a', idempotencyKey: 'idem-1',
  payload: { questionIds: ['q2', 'q1'], title: 'Paper', answerPosition: 'after-each', formulaMode: 'latex-vector' },
});
assert.strictEqual(draft.confirmed, false, 'network submission starts as a local draft');
const confirmed = workflow.confirmTaskDraft(draft, { id: 'task-1', status: 'pending_host', phase: 'queued', progress: 0 });
assert.deepStrictEqual([confirmed.confirmed, confirmed.taskId, confirmed.status], [true, 'task-1', 'pending_host']);
assert.strictEqual(workflow.canCancel(confirmed), true);
assert.strictEqual(workflow.canRetry({ ...confirmed, status: 'failed' }), true);
assert.strictEqual(workflow.isExpired({ ...confirmed, resultExpiresAt: '1970-01-01T00:00:00.050Z' }, 100), true);

console.log('question paper workflow checks passed');
