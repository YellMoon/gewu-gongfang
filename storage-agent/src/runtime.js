'use strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function createStorageAgentRuntime({
  worker, pollSeconds, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  heartbeat = null, heartbeatSeconds = 300, now = () => Date.now(),
} = {}) {
  if (!worker || typeof worker.runOnce !== 'function' || !Number.isSafeInteger(pollSeconds) || pollSeconds < 5 || pollSeconds > 300
    || typeof sleep !== 'function' || typeof now !== 'function'
    || (heartbeat !== null && (typeof heartbeat !== 'function' || !Number.isSafeInteger(heartbeatSeconds) || heartbeatSeconds < 5 || heartbeatSeconds > 3600))) {
    throw failure('STORAGE_AGENT_RUNTIME_CONFIG_INVALID');
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw failure('STORAGE_AGENT_RUNTIME_CONFIG_INVALID');
  let nextHeartbeatAt = startedAt + (heartbeatSeconds * 1000);
  return Object.freeze({
    runOnce: () => worker.runOnce(),
    async runForever({ shouldContinue = () => true, onResult = () => {} } = {}) {
      if (typeof shouldContinue !== 'function' || typeof onResult !== 'function') throw failure('STORAGE_AGENT_RUNTIME_CONFIG_INVALID');
      while (shouldContinue()) {
        let result;
        try {
          const currentTime = now();
          if (!Number.isFinite(currentTime)) throw failure('STORAGE_AGENT_RUNTIME_CONFIG_INVALID');
          if (heartbeat !== null && currentTime >= nextHeartbeatAt) {
            await heartbeat();
            nextHeartbeatAt = currentTime + (heartbeatSeconds * 1000);
          }
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
