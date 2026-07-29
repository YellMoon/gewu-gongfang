const assert = require('assert');
const { createHostCommandWorker } = require('./hostCommandWorker');

async function main() {
  const scheduled = [];
  const cleared = [];
  let processed = 0;
  const worker = createHostCommandWorker({
    processOnce: async () => ({ processed: ++processed }),
    intervalMs: 5000,
    setIntervalImpl: (callback, delay) => {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    clearIntervalImpl: timer => cleared.push(timer),
  });
  worker.start();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 5000);
  scheduled[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(processed, 1);
  assert.equal(worker.status().lastProcessed, 1);
  await worker.wake();
  assert.equal(processed, 2);
  worker.stop();
  assert.deepStrictEqual(cleared, [scheduled[0]]);

  let now = 1_000;
  let attempts = 0;
  const retryScheduled = [];
  const retryWorker = createHostCommandWorker({
    processOnce: async () => {
      attempts += 1;
      throw Object.assign(new Error('CLOUD_CONTROL_UNAVAILABLE'), { code: 'CLOUD_CONTROL_UNAVAILABLE' });
    },
    intervalMs: 1000,
    retryBaseMs: 2000,
    retryMaxMs: 8000,
    random: () => 0,
    now: () => now,
    setIntervalImpl: (callback, delay) => {
      const timer = { callback, delay };
      retryScheduled.push(timer);
      return timer;
    },
    clearIntervalImpl: () => {},
  });
  retryWorker.start();
  await retryWorker.wake();
  assert.equal(attempts, 1, 'the first cloud attempt must run');
  assert.equal(retryWorker.status().retry.consecutiveFailures, 1);
  assert.equal(retryWorker.status().retry.nextRetryAt, 3000);
  retryScheduled[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1, 'the periodic worker must skip cloud work during backoff');
  now = 3000;
  await retryWorker.wake();
  assert.equal(attempts, 2, 'the worker must recover automatically after bounded backoff');
  assert.equal(retryWorker.status().retry.nextRetryAt, 7000, 'the second failure must use exponential backoff');
  retryWorker.stop();
  console.log('hostCommandWorker tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
