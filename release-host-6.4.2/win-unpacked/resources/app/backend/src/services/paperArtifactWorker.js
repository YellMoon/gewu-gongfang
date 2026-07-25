const path = require('path');
const { Worker } = require('worker_threads');

function deserializeWorkerError(payload = {}) {
  return Object.assign(new Error(payload.message || 'paper artifact worker failed'), {
    name: payload.name || 'Error', code: payload.code, stack: payload.stack,
  });
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return Object.assign(new Error('paper artifact worker aborted'), { code: 'ABORT_ERR' });
}

function runPaperArtifactWorker(options = {}) {
  return new Promise((resolve, reject) => {
    const workerPath = options.workerPath || path.join(__dirname, 'paperArtifactWorkerRuntime.js');
    const worker = new Worker(workerPath, { workerData: options.workerData });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      if (settled) return;
      const error = abortError(options.signal);
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate().then(() => reject(error), terminateError => reject(terminateError));
    };
    if (options.signal?.aborted) { onAbort(); return; }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.on('message', async message => {
      if (settled) return;
      if (message?.type === 'progress') {
        try { options.onProgress?.(message.event); } catch (error) { await worker.terminate(); finish(reject, error); }
      } else if (message?.type === 'beforePublish') {
        try {
          await options.beforePublish?.();
          worker.postMessage({ type: 'beforePublishResult', requestId: message.requestId, ok: true });
        } catch (error) {
          worker.postMessage({ type: 'beforePublishResult', requestId: message.requestId, ok: false,
            error: { message: error.message, code: error.code, name: error.name, stack: error.stack } });
        }
      } else if (message?.type === 'result') finish(resolve, message.result);
      else if (message?.type === 'error') finish(reject, deserializeWorkerError(message.error));
    });
    worker.on('error', error => finish(reject, error));
    worker.on('exit', code => { if (!settled) finish(reject, Object.assign(new Error(`paper artifact worker exited with code ${code}`), { code: 'PAPER_ARTIFACT_WORKER_EXIT' })); });
  });
}

function writePaperArtifactInWorker(format, payload, questions, options = {}) {
  const workerOptions = {
    root: options.root, tempDir: options.tempDir, finalFileName: options.finalFileName,
    artifactIdentity: options.artifactIdentity, snapshotAssets: options.snapshotAssets || [],
  };
  return runPaperArtifactWorker({
    workerData: { format, payload, questions, options: workerOptions },
    signal: options.signal, onProgress: options.onProgress, beforePublish: options.beforePublish,
  });
}

module.exports = { runPaperArtifactWorker, writePaperArtifactInWorker };
