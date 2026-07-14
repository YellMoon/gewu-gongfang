const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');
const path = require('path');
const { writePaperArtifact } = require('./paperArtifactService');

function waitForPublishPermission() {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const listener = message => {
      if (message?.type !== 'beforePublishResult' || message.requestId !== requestId) return;
      parentPort.off('message', listener);
      if (message.ok) resolve();
      else reject(Object.assign(new Error(message.error?.message || 'publish rejected'), message.error || {}));
    };
    parentPort.on('message', listener);
    parentPort.postMessage({ type: 'beforePublish', requestId });
  });
}

(async () => {
  try {
    const { format, payload, questions, options } = workerData;
    const assets = new Map((options.snapshotAssets || []).map(asset => [String(asset.sourceKey || ''), asset]));
    const result = await writePaperArtifact(format, payload, questions, {
      ...options,
      resolveImageAsset: async key => {
        const asset = assets.get(String(key || '')); if (!asset) return null;
        const extension = path.extname(asset.sourceName || '').slice(1).toLowerCase().replace('jpg', 'jpeg');
        return { path: path.join(options.root, ...String(asset.blobPath || '').split('/')), contentType: `image/${extension}` };
      },
      onProgress: event => parentPort.postMessage({ type: 'progress', event }),
      beforePublish: waitForPublishPermission,
    });
    parentPort.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: { message: error.message, code: error.code, name: error.name, stack: error.stack } });
  }
})();
