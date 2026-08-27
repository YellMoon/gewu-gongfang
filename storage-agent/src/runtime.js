'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function createStorageAgentRuntime({ worker, pollSeconds, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  if (!worker || typeof worker.runOnce !== 'function' || !Number.isSafeInteger(pollSeconds) || pollSeconds < 5 || pollSeconds > 300
    || typeof sleep !== 'function') throw failure('STORAGE_AGENT_RUNTIME_CONFIG_INVALID');
  return Object.freeze({
    runOnce: () => worker.runOnce(),
    async runForever({ shouldContinue = () => true, onResult = () => {} } = {}) {
      if (typeof shouldContinue !== 'function' || typeof onResult !== 'function') throw failure('STORAGE_AGENT_RUNTIME_CONFIG_INVALID');
      while (shouldContinue()) {
        let result;
        try {
          result = await worker.runOnce();
        } catch (error) {
          const code = typeof error?.code === 'string' && error.code ? error.code : 'STORAGE_AGENT_WORKER_FAILED';
          result = Object.freeze({ state: 'retryable_error', code });
        }
        await onResult(result);
        if (shouldContinue()) await sleep(pollSeconds * 1000);
      }
    },
  });
}

module.exports = Object.freeze({ createStorageAgentRuntime });
