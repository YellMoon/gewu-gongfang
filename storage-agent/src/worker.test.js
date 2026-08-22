'use strict';

const assert = require('assert');

const { createStorageWorker } = require('./worker');

async function main() {
  const events = [];
  const leases = [null, { taskId: 'task_12345678' }];
  const worker = createStorageWorker({
    client: {
      async lease() {
        events.push('lease');
        return leases.shift();
      },
    },
  });

  assert.deepStrictEqual(await worker.runOnce(), { state: 'idle' });
  assert.deepStrictEqual(await worker.runOnce(), { state: 'blocked_missing_source', taskId: 'task_12345678' });
  assert.deepStrictEqual(events, ['lease', 'lease']);
  assert.throws(() => createStorageWorker({ client: {} }), /STORAGE_WORKER_CONFIG_INVALID/);
}

main().then(() => console.log('storage agent worker checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
