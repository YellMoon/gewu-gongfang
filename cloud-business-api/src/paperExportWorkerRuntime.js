'use strict';

function createPaperExportWorkerRuntime({ processor, intervalMs = 1000, setTimer = setInterval, clearTimer = clearInterval, log = () => {} } = {}) {
  if (!processor || typeof processor.runOnce !== 'function' || !Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 60000
    || typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof log !== 'function') {
    throw new TypeError('CLOUD_PAPER_WORKER_RUNTIME_INVALID');
  }
  let timer = null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await processor.runOnce();
      if (result.state === 'failed') log('paper export task failed: ' + result.taskId + ':' + result.code);
    } catch (error) {
      log('paper export worker unavailable: ' + String(error?.code || error?.message || error));
    } finally {
      running = false;
    }
  }
  return Object.freeze({
    start() {
      if (timer !== null) return;
      timer = setTimer(() => { void tick(); }, intervalMs);
      void tick();
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    tick,
  });
}

module.exports = Object.freeze({ createPaperExportWorkerRuntime });
