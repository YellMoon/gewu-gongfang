const assert = require('assert');
const Database = require('better-sqlite3');
const { createAuthorityProjectionWorker } = require('./authorityProjectionWorker');

async function main() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE primary_host_epochs (
    id TEXT PRIMARY KEY, db_authority_id TEXT NOT NULL, status TEXT NOT NULL
  )`);
  db.prepare("INSERT INTO primary_host_epochs VALUES('epoch-1','authority-1','active')").run();

  const calls = [];
  let fail = true;
  let now = 1000;
  const timers = [];
  const worker = createAuthorityProjectionWorker({
    db,
    publisher: {
      async publishAll(target) {
        calls.push(target);
        return fail
          ? { ...target, published: 1, failed: 1, failures: [{ code: 'CLOUD_DOWN' }] }
          : { ...target, published: 2, failed: 0, failures: [] };
      },
    },
    intervalMs: 1000,
    retryBaseMs: 2000,
    retryMaxMs: 8000,
    random: () => 0,
    now: () => now,
    setIntervalImpl: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearIntervalImpl: () => {},
  });

  worker.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1000);
  await worker.wake();
  assert.deepStrictEqual(calls[0], { authorityId: 'authority-1', hostEpochId: 'epoch-1' });
  assert.equal(worker.status().retry.consecutiveFailures, 1);
  assert.equal(worker.status().retry.nextRetryAt, 3000);
  await worker.wake();
  assert.equal(calls.length, 1, 'backoff must suppress an early retry');
  fail = false;
  now = 3000;
  await worker.wake();
  assert.equal(calls.length, 2);
  assert.equal(worker.status().lastProcessed, 2);
  assert.equal(worker.status().retry.consecutiveFailures, 0);

  db.prepare("UPDATE primary_host_epochs SET status='retired'").run();
  now = 4000;
  const idle = await worker.wake();
  assert.deepStrictEqual(idle, { processed: 0, skipped: 'AUTHORITY_HOST_EPOCH_INACTIVE' });
  worker.stop();
  db.close();
  console.log('authorityProjectionWorker tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
