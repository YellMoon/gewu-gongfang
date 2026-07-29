'use strict';

const assert = require('assert');
const { createPrimaryHostRuntimeStatus } = require('./primaryHostRuntimeStatus');

const worker = {
  status: () => Object.freeze({
    running: true,
    inFlight: false,
    lastProcessed: 3,
    lastCompletedAt: '2026-07-27T00:00:00.000Z',
    retry: Object.freeze({ consecutiveFailures: 0, nextRetryAt: null, lastError: null }),
  }),
};
const wakeup = {
  status: () => Object.freeze({
    running: true,
    cloud: Object.freeze({ state: 'connected', lastError: null, nextRetryAt: null }),
  }),
};
const projectionWorker = {
  status: () => Object.freeze({
    running: true,
    inFlight: false,
    lastProcessed: 5,
    lastCompletedAt: '2026-07-27T00:00:00.500Z',
    retry: Object.freeze({ consecutiveFailures: 0, nextRetryAt: null, lastError: null }),
  }),
};

const runtime = createPrimaryHostRuntimeStatus({ now: () => '2026-07-27T00:00:01.000Z' });
assert.deepStrictEqual(runtime.status().backend.state, 'starting');
runtime.markBackendListening({ host: '0.0.0.0', port: 60462 });
runtime.bindWorker(worker);
runtime.bindProjectionWorker(projectionWorker);
runtime.bindWakeup(wakeup);
const status = runtime.status();
assert.equal(status.ready, true, 'ready requires the actual backend and its one durable worker');
assert.equal(status.backend.port, 60462);
assert.equal(status.worker.lastProcessed, 3);
assert.equal(status.queue.lastProcessed, 3, 'queue metrics must derive from the authoritative worker');
assert.equal(status.projections.lastProcessed, 5);
assert.equal(status.projections.running, true);
assert.equal(status.cloud.state, 'connected', 'cloud state must derive from the actual wakeup transport');
runtime.markBackendFailed(Object.assign(new Error('LISTEN_FAILED'), { code: 'LISTEN_FAILED' }));
assert.equal(runtime.status().ready, false);
assert.equal(runtime.status().backend.lastError, 'LISTEN_FAILED');
console.log('primary host runtime status tests passed');
