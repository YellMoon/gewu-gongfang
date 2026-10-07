'use strict';
const path = require('path');
const root = path.resolve(__dirname, '../..');
const { createStorageCloudClient } = require(path.join(root, 'storage-agent/src/cloudClient'));
const { createStorageAgentRuntime } = require(path.join(root, 'storage-agent/src/runtime'));
let releaseBody;
let requestOptions;
let heartbeats = 0;
let fakeNow = 0;
let running = true;
let workerFinished = false;
const body = new Promise(resolve => { releaseBody = () => resolve({ ok: true, task: null }); });
const client = createStorageCloudClient({
  cloudBaseUrl: 'https://fixture.example', agentId: 'agent-test', token: '012345678901234567890123456789',
  fetch: async (url, options) => {
    requestOptions = options;
    return { status: 200, ok: true, json: () => body };
  },
});
const runtime = createStorageAgentRuntime({
  worker: { runOnce: () => client.lease() }, pollSeconds: 5, heartbeatSeconds: 300,
  now: () => fakeNow, heartbeat: async () => { heartbeats++; }, sleep: async () => {},
});
const loop = runtime.runForever({ shouldContinue: () => running, onResult: () => { workerFinished = true; } });
setTimeout(async () => {
  // Advance only the injected application clock; no 15-minute real wait occurs.
  fakeNow = 901000;
  running = false;
  const result = {
    simulatedSeconds: fakeNow / 1000, fetchHasAbortSignal: Boolean(requestOptions.signal),
    bodyStillAwaited: !workerFinished, heartbeats, stopFlagCannotFinishPendingWorker: !workerFinished,
    externalRequests: 0, productionWrites: 0,
  };
  console.log(JSON.stringify(result, null, 2));
  releaseBody();
  await loop;
  if (result.fetchHasAbortSignal || !result.bodyStillAwaited || result.heartbeats !== 0) process.exitCode = 1;
}, 50);
