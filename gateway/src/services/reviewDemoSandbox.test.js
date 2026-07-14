'use strict';

const assert = require('assert');
const {
  ANSWER_POSITIONS,
  FORMULA_MODES,
  TASK_TYPES,
  createReviewDemoSandbox,
  normalizedRequest,
} = require('./reviewDemoSandbox');

let now = Date.parse('2026-07-14T12:00:00.000Z');
const sandbox = createReviewDemoSandbox({ now: () => now, ttlMs: 1_000, maxTasks: 4, maxArtifactBytes: 4 * 1024 * 1024 });
const base = {
  questionIds: ['review-q-1', 'review-q-2'],
  title: 'Review Sample Paper',
  answerPosition: 'end',
  formulaMode: 'word-native',
};

(async () => {
  assert.deepStrictEqual([...TASK_TYPES], ['question-paper', 'paper-export-word', 'paper-export-pdf']);
  assert.deepStrictEqual([...ANSWER_POSITIONS], ['end', 'after-each']);
  assert.deepStrictEqual([...FORMULA_MODES], ['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']);
  for (const taskType of TASK_TYPES) assert.strictEqual(normalizedRequest({ ...base, taskType }).taskType, taskType);
  for (const answerPosition of ANSWER_POSITIONS) assert.strictEqual(normalizedRequest({ ...base, taskType: 'question-paper', answerPosition }).answerPosition, answerPosition);
  for (const formulaMode of FORMULA_MODES) assert.strictEqual(normalizedRequest({ ...base, taskType: 'question-paper', formulaMode }).formulaMode, formulaMode);

  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', questionIds: ['real-question'] }),
    error => error.code === 'REVIEW_DEMO_QUESTION_INVALID' && error.statusCode === 400,
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', formulaMode: 'unsafe' }),
    error => error.code === 'REVIEW_DEMO_FORMULA_MODE_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', answerPosition: 'hidden' }),
    error => error.code === 'REVIEW_DEMO_ANSWER_POSITION_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'real-export' }),
    error => error.code === 'REVIEW_DEMO_TASK_TYPE_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'question-paper', questionIds: Array(21).fill('review-q-1') }),
    error => error.code === 'REVIEW_DEMO_QUESTION_COUNT_INVALID',
  );
  await assert.rejects(
    sandbox.create('session-a', { ...base, taskType: 'question-paper', title: 'x'.repeat(81) }),
    error => error.code === 'REVIEW_DEMO_TITLE_INVALID',
  );

  const paper = await sandbox.create('session-a', { ...base, taskType: 'question-paper' });
  assert.strictEqual(paper.status, 'completed');
  assert.strictEqual(paper.result.questionCount, 2);
  assert.strictEqual(paper.artifact, null);

  const word = await sandbox.create('session-a', { ...base, title: '../../Review: Paper?\r\n', taskType: 'paper-export-word' });
  assert.strictEqual(word.artifact.buffer.subarray(0, 2).toString(), 'PK');
  assert.strictEqual(word.artifact.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(word.artifact.fileName, /^Review-Paper-[a-f0-9]{8}\.docx$/);
  assert.ok(!/[\\/\r\n]/.test(word.artifact.fileName));

  const pdf = await sandbox.create('session-a', { ...base, taskType: 'paper-export-pdf', answerPosition: 'after-each', formulaMode: 'latex-vector' });
  assert.strictEqual(pdf.artifact.buffer.subarray(0, 4).toString(), '%PDF');
  assert.strictEqual(pdf.artifact.mimeType, 'application/pdf');
  assert.ok(pdf.artifact.fileName.endsWith('.pdf'));

  assert.strictEqual(sandbox.getTask('session-a', word.id).id, word.id);
  assert.throws(() => sandbox.getTask('session-b', word.id), error => error.code === 'REVIEW_DEMO_TASK_NOT_FOUND');
  assert.throws(() => sandbox.getArtifact('session-b', word.artifact.id), error => error.code === 'REVIEW_DEMO_ARTIFACT_NOT_FOUND');
  assert.strictEqual(sandbox.getArtifact('session-a', word.artifact.id).buffer.length, word.artifact.buffer.length);

  const cancelled = sandbox.cancel('session-a', paper.id);
  assert.strictEqual(cancelled.status, 'cancelled');

  const cancelSandbox = createReviewDemoSandbox();
  const cancelWord = await cancelSandbox.create('cancel-session', { ...base, taskType: 'paper-export-word' });
  const cancelledArtifactId = cancelWord.artifact.id;
  cancelSandbox.cancel('cancel-session', cancelWord.id);
  assert.throws(() => cancelSandbox.getArtifact('cancel-session', cancelledArtifactId), error => error.code === 'REVIEW_DEMO_ARTIFACT_NOT_FOUND');

  const boundedTasks = createReviewDemoSandbox({ maxTasks: 1 });
  await boundedTasks.create('session-a', { ...base, taskType: 'question-paper' });
  await assert.rejects(
    boundedTasks.create('session-a', { ...base, taskType: 'question-paper' }),
    error => error.code === 'REVIEW_DEMO_SANDBOX_BUSY' && error.statusCode === 429,
  );

  const concurrentTasks = createReviewDemoSandbox({ maxTasks: 1 });
  const concurrentResults = await Promise.allSettled([
    concurrentTasks.create('session-a', { ...base, taskType: 'paper-export-word' }),
    concurrentTasks.create('session-b', { ...base, taskType: 'paper-export-pdf' }),
  ]);
  assert.strictEqual(concurrentResults.filter(result => result.status === 'fulfilled').length, 1);
  assert.strictEqual(concurrentResults.filter(result => result.reason?.code === 'REVIEW_DEMO_SANDBOX_BUSY').length, 1);
  assert.strictEqual(concurrentTasks.stats().tasks, 1);

  const boundedArtifacts = createReviewDemoSandbox({ maxArtifactBytes: 4 * 1024 });
  const firstSmallPdf = await boundedArtifacts.create('session-a', { ...base, taskType: 'paper-export-pdf' });
  assert.ok(firstSmallPdf.artifact.buffer.length < 4 * 1024);
  await assert.rejects(
    boundedArtifacts.create('session-a', { ...base, taskType: 'paper-export-pdf' }),
    error => error.code === 'REVIEW_DEMO_ARTIFACT_CAPACITY_EXCEEDED' && error.statusCode === 429,
  );

  now += 2_000;
  assert.throws(() => sandbox.getTask('session-a', word.id), error => error.code === 'REVIEW_DEMO_TASK_EXPIRED');
  assert.throws(() => sandbox.getArtifact('session-a', pdf.artifact.id), error => error.code === 'REVIEW_DEMO_ARTIFACT_EXPIRED');
  assert.deepStrictEqual(sandbox.stats(), { tasks: 0, artifacts: 0, bytes: 0 });

  console.log('review demo sandbox checks passed');
})().catch(error => { console.error(error); process.exit(1); });
