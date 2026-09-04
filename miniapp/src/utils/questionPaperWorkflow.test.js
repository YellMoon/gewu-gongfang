const assert = require('assert');
const workflow = require('./questionPaperWorkflow');

const selection = workflow.toggleOrderedSelection([], 'q2');
assert.deepStrictEqual(workflow.toggleOrderedSelection(selection, 'q1'), ['q2', 'q1']);
assert.deepStrictEqual(workflow.toggleOrderedSelection(['q2', 'q1'], 'q2'), ['q1']);

const layout = { items: [{ id: 'q2', sectionTitle: 'Part one', score: 3 }, { id: 'q1', sectionTitle: 'Part two', score: 6 }] };
const draft = workflow.createTaskDraft({ taskType: 'paper-export-pdf', questionIds: ['q2', 'q1'], title: 'Paper', answerPosition: 'after', formulaMode: 'latex-vector', layout }, { now: 100, idFactory: () => 'idem-1' });
assert.deepStrictEqual(draft.request, {
  protocolVersion: 3, taskType: 'paper-export-pdf', idempotencyKey: 'idem-1',
  payload: { questionIds: ['q2', 'q1'], title: 'Paper', answerPosition: 'after', formulaMode: 'latex-vector', layout },
});
assert.strictEqual(draft.confirmed, false, 'network submission starts as a local draft');
const confirmed = workflow.confirmTaskDraft(draft, { id: 'task-1', status: 'queued', phase: 'queued', progress: 0 });
assert.deepStrictEqual([confirmed.confirmed, confirmed.taskId, confirmed.status], [true, 'task-1', 'queued']);
assert.strictEqual(workflow.canCancel(confirmed), true);
assert.strictEqual(workflow.canRetry({ ...confirmed, status: 'failed' }), true);
assert.strictEqual(workflow.isExpired({ ...confirmed, resultExpiresAt: '1970-01-01T00:00:00.050Z' }, 100), true);

const customPaperOrder = [
  { id: 'q3', sectionTitle: 'Custom', score: 8 },
  { id: 'q1', sectionTitle: 'Part one', score: 3 },
  { id: 'q2', sectionTitle: 'Part two', score: 6 },
];
assert.deepStrictEqual(
  workflow.reconcilePaperItemsWithBasket(customPaperOrder, ['q1', 'q3']),
  [customPaperOrder[0], customPaperOrder[1]],
  'removing a basket item must preserve the editor\'s deliberate paper order',
);
assert.deepStrictEqual(
  workflow.unavailableSelectionIds(['q2', 'missing', 'q1'], [{ id: 'q1' }, { id: 'q2' }]),
  ['missing'],
  'paper composition must detect every selected question missing from the current cloud catalog',
);

const invalidPrecisionInput = workflow.applyPaperLayoutFieldEdit(
  { id: 'q1', sectionTitle: 'Part one', score: 3 },
  { field: 'score', value: '1000.11', phase: 'input' },
);
const invalidPrecisionBlur = workflow.applyPaperLayoutFieldEdit(
  { id: 'q1', sectionTitle: 'Part one', score: 3 },
  { field: 'score', value: '1000.11', phase: 'blur' },
);
assert.strictEqual(invalidPrecisionInput.valid, false, 'two-decimal score input must not enter the layout');
assert.strictEqual(invalidPrecisionInput.patch, null, 'invalid input must preserve the last valid item value');
assert.strictEqual(invalidPrecisionInput.showError, false, 'typing may show an inline error without interrupting every keystroke');
assert.strictEqual(invalidPrecisionBlur.showError, true, 'leaving an invalid score must request a visible error prompt');
assert.strictEqual(invalidPrecisionBlur.error, invalidPrecisionInput.error, 'input and blur must use the same score constraint');

const validDecimalInput = workflow.applyPaperLayoutFieldEdit(
  { id: 'q1', sectionTitle: 'Part one', score: 3 },
  { field: 'score', value: '2.5', phase: 'input' },
);
assert.deepStrictEqual(validDecimalInput.patch, { score: 2.5 }, 'a valid decimal score updates the live total immediately');
const trimmedSectionBlur = workflow.applyPaperLayoutFieldEdit(
  { id: 'q1', sectionTitle: 'Part one', score: 3 },
  { field: 'sectionTitle', value: '  Mechanics  ', phase: 'blur' },
);
assert.deepStrictEqual(trimmedSectionBlur.patch, { sectionTitle: 'Mechanics' }, 'section names commit their normalized value on blur');

const tooLongSectionTitle = 'x'.repeat(129);
const invalidLayout = workflow.validateAndNormalizePaperLayout({
  questionIds: ['q1', 'q2', 'q3'],
  items: [
    { id: 'q1', sectionTitle: 'Part one', score: '1000.11' },
    { id: 'q2', sectionTitle: 'Part two', score: '1001' },
    { id: 'q3', sectionTitle: tooLongSectionTitle, score: '3' },
  ],
});
assert.strictEqual(invalidLayout.valid, false, 'submit validation must reject every server-incompatible layout value');
assert.deepStrictEqual(
  invalidLayout.errors.map(error => [error.itemId, error.field]),
  [['q1', 'score'], ['q2', 'score'], ['q3', 'sectionTitle']],
  'submit validation must inspect the complete layout instead of stopping after the first invalid item',
);
assert.throws(
  () => workflow.createTaskDraft({
    taskType: 'paper-export-pdf', questionIds: ['q1', 'q2', 'q3'], title: 'Paper', answerPosition: 'end', formulaMode: 'latex-vector',
    layout: { items: invalidLayout.inputItems },
  }),
  /PAPER_LAYOUT_INVALID/,
  'the draft boundary must never serialize a layout that the cloud will reject',
);

const normalizedLayout = workflow.validateAndNormalizePaperLayout({
  questionIds: ['q1', 'q2'],
  items: [
    { id: 'q1', sectionTitle: '  Part one  ', score: '2.5' },
    { id: 'q2', sectionTitle: 'Part two', score: 1000 },
  ],
});
assert.strictEqual(normalizedLayout.valid, true);
assert.deepStrictEqual(normalizedLayout.layout, {
  items: [
    { id: 'q1', sectionTitle: 'Part one', score: 2.5 },
    { id: 'q2', sectionTitle: 'Part two', score: 1000 },
  ],
}, 'valid edits must be normalized to the exact cloud layout contract before submission');

console.log('question paper workflow checks passed');
