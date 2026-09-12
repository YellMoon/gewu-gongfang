'use strict';
const assert = require('assert/strict');
const { listAllQuestionPages } = require('./real-question-import-publish');
(async () => {
  const cursors = [];
  const rows = await listAllQuestionPages(async afterId => {
    cursors.push(afterId);
    return afterId === null ? { questions: [{ id: 'q-a' }], nextCursor: 'q-a' }
      : { questions: [{ id: 'q-b' }], nextCursor: null };
  });
  assert.deepEqual(rows.map(row => row.id), ['q-a', 'q-b']);
  assert.deepEqual(cursors, [null, 'q-a']);
  await assert.rejects(() => listAllQuestionPages(async () => ({ questions: [{ id: 'q-a' }], nextCursor: 'q-a' })),
    /REAL_QUESTION_IMPORT_PUBLISH_LIST_INVALID/);
  await assert.rejects(() => listAllQuestionPages(async () => ({ questions: null })),
    /REAL_QUESTION_IMPORT_PUBLISH_LIST_INVALID/);
  assert.deepEqual(await listAllQuestionPages(async () => ({ questions: [], nextCursor: null })), []);
  console.log('real question import pagination checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
