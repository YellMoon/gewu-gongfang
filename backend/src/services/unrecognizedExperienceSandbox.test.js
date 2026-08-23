'use strict';

const assert = require('assert');
const { createUnrecognizedExperienceSandbox } = require('./unrecognizedExperienceSandbox');
const { EXPERIENCE_QUESTION_IDS } = require('./unrecognizedExperienceData');

(async () => {
  let current = 1_700_000_000_000;
  const sandbox = createUnrecognizedExperienceSandbox({ now: () => current, ttlMs: 100 });
  const paper = sandbox.create('session-a', { taskType: 'question-paper', title: 'paper', questionIds: [EXPERIENCE_QUESTION_IDS[0]] });
  assert.deepStrictEqual([paper.status, paper.phase, paper.progress], ['completed', 'completed', 100]);
  assert.strictEqual(paper.result.questions.length, 1);
  await assert.rejects(
    async () => sandbox.waitForTask('session-b', paper.id),
    error => error.code === 'UNRECOGNIZED_EXPERIENCE_TASK_NOT_FOUND',
  );
  assert.throws(
    () => sandbox.create('session-a', { taskType: 'paper-export-pdf', title: 'paper', questionIds: [EXPERIENCE_QUESTION_IDS[0]] }),
    error => error.code === 'UNRECOGNIZED_EXPERIENCE_TASK_TYPE_INVALID',
  );
  assert.deepStrictEqual(sandbox.stats(), { tasks: 1, artifacts: 0, bytes: 0, activeGenerations: 0, queuedGenerations: 0 });
  current += 101;
  assert.throws(() => sandbox.getTask('session-a', paper.id), error => error.code === 'UNRECOGNIZED_EXPERIENCE_TASK_EXPIRED');
  await sandbox.close();
  console.log('unrecognized experience read-only sandbox checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
