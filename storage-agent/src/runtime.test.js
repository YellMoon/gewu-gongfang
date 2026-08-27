'use strict';

const assert = require('assert');

const { createStorageAgentRuntime } = require('./runtime');

async function main() {
  const events = [];
  const runtime = createStorageAgentRuntime({
    worker: {
      async runOnce() { events.push('run'); return events.length === 1 ? { state: 'verified', taskId: 'task_12345678' } : { state: 'idle' }; },
    },
    pollSeconds: 5,
    sleep: async milliseconds => { events.push(`sleep:${milliseconds}`); },
  });
  assert.deepStrictEqual(await runtime.runOnce(), { state: 'verified', taskId: 'task_12345678' });
  await runtime.runForever({ shouldContinue: () => events.filter(value => value === 'run').length < 3 });
  assert.deepStrictEqual(events, ['run', 'run', 'sleep:5000', 'run']);

  const retryEvents = [];
  const retryRuntime = createStorageAgentRuntime({
    worker: {
      async runOnce() {
        retryEvents.push('run');
        if (retryEvents.filter(value => value === 'run').length === 1) throw Object.assign(new Error('cloud unavailable'), { code: 'STORAGE_CLOUD_HTTP_503' });
        return { state: 'idle' };
      },
    },
    pollSeconds: 5,
    sleep: async milliseconds => { retryEvents.push(`sleep:${milliseconds}`); },
  });
  await retryRuntime.runForever({
    shouldContinue: () => retryEvents.filter(value => value === 'run').length < 2,
    onResult: async result => { retryEvents.push(`${result.state}:${result.code || ''}`); },
  });
  assert.deepStrictEqual(retryEvents, ['run', 'retryable_error:STORAGE_CLOUD_HTTP_503', 'sleep:5000', 'run', 'idle:']);
  assert.throws(() => createStorageAgentRuntime({ worker: {}, pollSeconds: 5 }), /STORAGE_AGENT_RUNTIME_CONFIG_INVALID/);
}

main().then(() => console.log('storage agent runtime checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
