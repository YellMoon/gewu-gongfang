'use strict';

const assert = require('assert');
const { createPaperExportTaskProcessor } = require('./paperExportTaskProcessor');

(async () => {
  const events = [];
  const task = {
    taskId: 'paper_task_1', tenantId: 'default', accountId: 'account-1', format: 'pdf', fileName: 'paper.pdf',
    request: { title: 'Paper', answerPosition: 'end', formulaMode: 'word-native', layout: { items: [{ id: 'q1', sectionTitle: 'Part one', score: 3 }] } }, snapshot: [{ id: 'q1', stem: 'question', answer: 'answer', assets: [{ assetKey: 'a'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png' }] }],
  };
  const processor = createPaperExportTaskProcessor({
    tasks: {
      claimNext: async () => task,
      complete: async input => events.push(['complete', input]),
      fail: async input => events.push(['fail', input]),
      defer: async input => events.push(['defer', input]),
    },
    render: async (input, options) => {
      events.push(['render', input]);
      assert.deepStrictEqual(await options.resolveQuestionAsset({ questionId: 'q1', assetKey: 'a'.repeat(64), fileName: 'diagram.png', mimeType: 'image/png' }), Buffer.from('image'));
      return { bytes: Buffer.from('%PDF-test'), mimeType: 'application/pdf' };
    },
    mediaResolver: async input => { events.push(['media', input]); return Buffer.from('image'); },
    archiveArtifact: async input => {
      events.push(['archive', input]);
      return { artifactId: 'paper_artifact_1' };
    },
  });
  assert.deepStrictEqual(await processor.runOnce(), { state: 'archived', taskId: 'paper_task_1', artifactId: 'paper_artifact_1' });
  assert.deepStrictEqual(events.map(row => row[0]), ['render', 'media', 'archive', 'complete']);
  assert.deepStrictEqual(events[0][1].layout, { items: [{ id: 'q1', sectionTitle: 'Part one', score: 3 }] }, 'paper layout must reach the cloud renderer together with the selected snapshot');
  const idle = createPaperExportTaskProcessor({
    tasks: { claimNext: async () => null, complete: async () => {}, fail: async () => {}, defer: async () => {} },
    render: async () => { throw new Error('unexpected'); }, archiveArtifact: async () => { throw new Error('unexpected'); },
  });
  assert.deepStrictEqual(await idle.runOnce(), { state: 'idle' });
  const pendingEvents = [];
  const pending = createPaperExportTaskProcessor({
    tasks: { claimNext: async () => task, complete: async () => { throw new Error('unexpected'); }, fail: async () => { throw new Error('unexpected'); }, defer: async input => pendingEvents.push(input) },
    render: async () => { throw Object.assign(new Error('CLOUD_PAPER_EXPORT_MEDIA_PENDING'), { code: 'CLOUD_PAPER_EXPORT_MEDIA_PENDING' }); },
    archiveArtifact: async () => { throw new Error('unexpected'); },
  });
  assert.deepStrictEqual(await pending.runOnce(), { state: 'media_pending', taskId: 'paper_task_1' });
  assert.deepStrictEqual(pendingEvents, [{ taskId: 'paper_task_1' }]);
  console.log('paper export task processor checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
