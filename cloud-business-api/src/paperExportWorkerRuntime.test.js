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
  let allowed=false,finish;
  const gate=new Promise(resolve=>{finish=resolve;});
  const guarded=createPaperExportWorkerRuntime({processor:{runOnce:async()=>{calls++;await gate;return{state:'idle'};}},canRun:()=>allowed});
  await guarded.tick();assert.equal(calls,2);assert.equal(guarded.isRunning(),false);
  allowed=true;const pending=guarded.tick();assert.equal(guarded.isRunning(),true);await guarded.tick();assert.equal(calls,3);finish();await pending;assert.equal(guarded.isRunning(),false);
  console.log('paper export worker runtime checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
