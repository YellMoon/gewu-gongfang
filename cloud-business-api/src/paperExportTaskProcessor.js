'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function createPaperExportTaskProcessor({ tasks, render, archiveArtifact, mediaResolver, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  if (!tasks || typeof tasks.claimNext !== 'function' || typeof tasks.complete !== 'function' || typeof tasks.fail !== 'function'
    || typeof tasks.defer !== 'function' || typeof render !== 'function' || typeof archiveArtifact !== 'function'
    || typeof tasks.renew !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function'
    || (mediaResolver !== undefined && typeof mediaResolver !== 'function')) {
    throw failure('CLOUD_PAPER_PROCESSOR_CONFIG_INVALID');
  }
  return Object.freeze({
    async runOnce() {
      const task = await tasks.claimNext();
      if (task === null) return Object.freeze({ state: 'idle' });
      const owned = { taskId: task.taskId, claimToken: task.claimToken };
      let ownershipError = null, renewal = null;
      const renew = () => {
        if (!renewal && !ownershipError) {
          renewal = Promise.resolve().then(() => tasks.renew(owned))
            .catch(error => { ownershipError = error; }).finally(() => { renewal = null; });
        }
        return renewal;
      };
      let timer = setTimer(renew, 15000);
      timer?.unref?.();
      const stopRenewing = async () => {
        if (timer !== null) { clearTimer(timer); timer = null; }
        if (renewal) await renewal;
      };
      const abandoned = () => Object.freeze({ state: 'abandoned', taskId: task.taskId, code: 'CLOUD_PAPER_EXPORT_CLAIM_LOST' });
      try {
        const rendered = await render({
          format: task.format,
          title: task.request.title,
          answerPosition: task.request.answerPosition,
          formulaMode: task.request.formulaMode,
          layout: task.request.layout || null,
          snapshot: task.snapshot,
        }, {
          resolveQuestionAsset: mediaResolver
            ? descriptor => {
              if (ownershipError) throw ownershipError;
              return mediaResolver({ tenantId: task.tenantId, accountId: task.accountId, taskId: task.taskId, ...descriptor });
            }
            : undefined,
        });
        await renew();
        if (ownershipError) return abandoned();
        const artifact = await archiveArtifact({
          taskId: task.taskId,
          claimToken: task.claimToken,
          tenantId: task.tenantId,
          accountId: task.accountId,
          format: task.format,
          fileName: task.fileName,
          mimeType: rendered.mimeType,
          bytes: rendered.bytes,
        });
        await stopRenewing();
        await tasks.complete({ ...owned, artifact });
        return Object.freeze({ state: 'archived', taskId: task.taskId, artifactId: artifact.artifactId });
      } catch (error) {
        await stopRenewing();
        if (ownershipError || error?.code === 'CLOUD_PAPER_EXPORT_CLAIM_LOST') return abandoned();
        try {
          if (error?.code === 'CLOUD_PAPER_EXPORT_MEDIA_PENDING') {
            await tasks.defer(owned);
            return Object.freeze({ state: 'media_pending', taskId: task.taskId });
          }
          await tasks.fail({ ...owned, code: String(error?.code || 'CLOUD_PAPER_RENDER_FAILED') });
          return Object.freeze({ state: 'failed', taskId: task.taskId, code: String(error?.code || 'CLOUD_PAPER_RENDER_FAILED') });
        } catch (writeError) {
          if (writeError?.code === 'CLOUD_PAPER_EXPORT_CLAIM_LOST') return abandoned();
          throw writeError;
        }
      } finally {
        await stopRenewing();
      }
    },
  });
}

module.exports = Object.freeze({ createPaperExportTaskProcessor });
