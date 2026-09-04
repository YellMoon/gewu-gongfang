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

  let clock = 0;
  const heartbeatEvents = [];
  const heartbeatRuntime = createStorageAgentRuntime({
    worker: {
      async runOnce() { heartbeatEvents.push('run'); return { state: 'idle' }; },
    },
    pollSeconds: 5,
    heartbeatSeconds: 5,
    heartbeat: async () => { heartbeatEvents.push('heartbeat'); },
    now: () => clock,
    sleep: async milliseconds => { heartbeatEvents.push(`sleep:${milliseconds}`); clock += milliseconds; },
  });
  await heartbeatRuntime.runForever({ shouldContinue: () => heartbeatEvents.filter(value => value === 'run').length < 3 });
  assert.deepStrictEqual(heartbeatEvents, [
    'run', 'sleep:5000', 'heartbeat', 'run', 'sleep:5000', 'heartbeat', 'run',
  ], 'the normal poll loop must refresh the runtime receipt at a bounded interval without a detached timer');
  assert.throws(() => createStorageAgentRuntime({ worker: {}, pollSeconds: 5 }), /STORAGE_AGENT_RUNTIME_CONFIG_INVALID/);
  assert.throws(() => createStorageAgentRuntime({ worker: { runOnce() {} }, pollSeconds: 5, heartbeat: async () => {}, heartbeatSeconds: 4 }),
    /STORAGE_AGENT_RUNTIME_CONFIG_INVALID/);
}

main().then(() => console.log('storage agent runtime checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
