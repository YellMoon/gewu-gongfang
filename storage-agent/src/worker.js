'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function createStorageWorker({ client } = {}) {
  if (!client || typeof client.lease !== 'function') throw failure('STORAGE_WORKER_CONFIG_INVALID');
  return Object.freeze({
    async runOnce() {
      const task = await client.lease();
      if (task === null) return Object.freeze({ state: 'idle' });
      return Object.freeze({ state: 'blocked_missing_source', taskId: task.taskId });
    },
  });
}

module.exports = Object.freeze({ createStorageWorker });
