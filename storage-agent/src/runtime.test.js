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
  assert.throws(() => createStorageAgentRuntime({ worker: {}, pollSeconds: 5 }), /STORAGE_AGENT_RUNTIME_CONFIG_INVALID/);
}

main().then(() => console.log('storage agent runtime checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
