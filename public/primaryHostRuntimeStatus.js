'use strict';

function errorCode(error) {
  return error?.code || error?.message || 'PRIMARY_HOST_RUNTIME_FAILED';
}

function createPrimaryHostRuntimeStatus({ now = () => new Date().toISOString() } = {}) {
  let backend = Object.freeze({ state: 'starting', host: null, port: null, lastError: null, updatedAt: now() });
  let worker = null;
  let projectionWorker = null;
  let wakeup = null;

  function updateBackend(next) {
    backend = Object.freeze({ ...backend, ...next, updatedAt: now() });
  }

  return Object.freeze({
    markBackendListening({ host, port } = {}) {
      updateBackend({ state: 'listening', host: String(host || ''), port: Number(port) || null, lastError: null });
    },
    markBackendFailed(error) {
      updateBackend({ state: 'failed', lastError: errorCode(error) });
    },
    bindWorker(value) { worker = value || null; },
    bindProjectionWorker(value) { projectionWorker = value || null; },
    bindWakeup(value) { wakeup = value || null; },
    status() {
      const workerStatus = worker?.status?.() || Object.freeze({ running: false, unavailable: true });
      const projectionStatus = projectionWorker?.status?.()
        || Object.freeze({ running: false, unavailable: true });
      const wakeupStatus = wakeup?.status?.() || Object.freeze({
        running: false,
        cloud: Object.freeze({ state: 'not-configured', lastError: null, nextRetryAt: null }),
      });
      return Object.freeze({
        contractVersion: 1,
        role: 'primary-host',
        ready: backend.state === 'listening'
          && workerStatus.running === true
          && projectionStatus.running === true,
        backend,
        worker: workerStatus,
        projections: projectionStatus,
        cloud: wakeupStatus.cloud,
        queue: Object.freeze({
          lastProcessed: Number(workerStatus.lastProcessed || 0),
          lastCompletedAt: workerStatus.lastCompletedAt || null,
          inFlight: workerStatus.inFlight === true,
          retry: workerStatus.retry || null,
        }),
      });
    },
  });
}

module.exports = { createPrimaryHostRuntimeStatus };
