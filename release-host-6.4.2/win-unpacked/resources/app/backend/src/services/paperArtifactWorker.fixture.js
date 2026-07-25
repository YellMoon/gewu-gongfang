const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');

const until = Date.now() + workerData.syncRenderMs;
while (Date.now() < until) { /* deliberately block this worker's event loop */ }
fs.writeFileSync(workerData.finalPath, 'late artifact');
parentPort.postMessage({ type: 'result', result: { filePath: workerData.finalPath } });
