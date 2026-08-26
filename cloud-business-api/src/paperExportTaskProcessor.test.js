'use strict';

const assert = require('assert');
const { createPaperExportTaskProcessor } = require('./paperExportTaskProcessor');

(async () => {
  const events = [];
  const task = {
    taskId: 'paper_task_1', tenantId: 'default', accountId: 'account-1', format: 'pdf', fileName: 'paper.pdf',
    request: { title: 'Paper', answerPosition: 'end', layout: { items: [{ id: 'q1', sectionTitle: 'Part one', score: 3 }] } }, snapshot: [{ id: 'q1', stem: 'question', answer: 'answer' }],
  };
  const processor = createPaperExportTaskProcessor({
    tasks: {
      claimNext: async () => task,
      complete: async input => events.push(['complete', input]),
      fail: async input => events.push(['fail', input]),
    },
    render: async input => {
      events.push(['render', input]);
      return { bytes: Buffer.from('%PDF-test'), mimeType: 'application/pdf' };
    },
    archiveArtifact: async input => {
      events.push(['archive', input]);
      return { artifactId: 'paper_artifact_1' };
    },
  });
  assert.deepStrictEqual(await processor.runOnce(), { state: 'archived', taskId: 'paper_task_1', artifactId: 'paper_artifact_1' });
  assert.deepStrictEqual(events.map(row => row[0]), ['render', 'archive', 'complete']);
  assert.deepStrictEqual(events[0][1].layout, { items: [{ id: 'q1', sectionTitle: 'Part one', score: 3 }] }, 'paper layout must reach the cloud renderer together with the selected snapshot');
  const idle = createPaperExportTaskProcessor({
    tasks: { claimNext: async () => null, complete: async () => {}, fail: async () => {} },
    render: async () => { throw new Error('unexpected'); }, archiveArtifact: async () => { throw new Error('unexpected'); },
  });
  assert.deepStrictEqual(await idle.runOnce(), { state: 'idle' });
  console.log('paper export task processor checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
