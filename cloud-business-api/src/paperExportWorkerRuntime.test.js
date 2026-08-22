'use strict';

const assert = require('assert');
const { createPaperExportWorkerRuntime } = require('./paperExportWorkerRuntime');

(async () => {
  const timers = [];
  let calls = 0;
  const runtime = createPaperExportWorkerRuntime({
    processor: { runOnce: async () => { calls += 1; return { state: 'idle' }; } },
    intervalMs: 250,
    setTimer: callback => { timers.push(callback); return 1; },
    clearTimer: value => { assert.strictEqual(value, 1); },
  });
  runtime.start();
  await Promise.resolve();
  assert.strictEqual(calls, 1);
  await timers[0]();
  assert.strictEqual(calls, 2);
  runtime.stop();
  console.log('paper export worker runtime checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
