'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function createPaperExportTaskProcessor({ tasks, render, archiveArtifact } = {}) {
  if (!tasks || typeof tasks.claimNext !== 'function' || typeof tasks.complete !== 'function' || typeof tasks.fail !== 'function'
    || typeof render !== 'function' || typeof archiveArtifact !== 'function') {
    throw failure('CLOUD_PAPER_PROCESSOR_CONFIG_INVALID');
  }
  return Object.freeze({
    async runOnce() {
      const task = await tasks.claimNext();
      if (task === null) return Object.freeze({ state: 'idle' });
      try {
        const rendered = await render({
          format: task.format,
          title: task.request.title,
          answerPosition: task.request.answerPosition,
          layout: task.request.layout || null,
          snapshot: task.snapshot,
        });
        const artifact = await archiveArtifact({
          taskId: task.taskId,
          tenantId: task.tenantId,
          accountId: task.accountId,
          format: task.format,
          fileName: task.fileName,
          mimeType: rendered.mimeType,
          bytes: rendered.bytes,
        });
        await tasks.complete({ taskId: task.taskId, artifact });
        return Object.freeze({ state: 'archived', taskId: task.taskId, artifactId: artifact.artifactId });
      } catch (error) {
        await tasks.fail({ taskId: task.taskId, code: String(error?.code || 'CLOUD_PAPER_RENDER_FAILED') });
        return Object.freeze({ state: 'failed', taskId: task.taskId, code: String(error?.code || 'CLOUD_PAPER_RENDER_FAILED') });
      }
    },
  });
}

module.exports = Object.freeze({ createPaperExportTaskProcessor });
