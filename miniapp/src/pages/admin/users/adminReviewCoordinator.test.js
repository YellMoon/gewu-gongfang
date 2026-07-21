const assert = require('assert');
const { createLatestRequestCoordinator, createOperationLocks } = require('./adminReviewCoordinator');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

(async () => {
  const commits = [];
  const coordinator = createLatestRequestCoordinator();
  const slow = deferred();
  const fast = deferred();
  const first = coordinator.run(() => slow.promise, value => commits.push(value));
  const second = coordinator.run(() => fast.promise, value => commits.push(value));
  fast.resolve('latest');
  await second;
  slow.resolve('stale');
  await first;
  assert.deepStrictEqual(commits, ['latest'], 'an older response must not overwrite the latest load');
  assert.strictEqual(coordinator.isLoading(), false);

  const locks = createOperationLocks();
  const userTask = deferred();
  let userRuns = 0;
  const active = locks.run('user:user-1', async () => { userRuns += 1; await userTask.promise; });
  const duplicate = await locks.run('user:user-1', async () => { userRuns += 1; });
  assert.strictEqual(duplicate, false, 'duplicate click for the same user must be rejected');
  assert.strictEqual(userRuns, 1);
  assert.strictEqual(locks.isLocked('user:user-1'), true);
  userTask.resolve();
  await active;
  assert.strictEqual(locks.isLocked('user:user-1'), false, 'user lock must clear in finally');

  const pairingTask = deferred();
  const pairing = locks.run('pairing:code-1', () => pairingTask.promise);
  assert.strictEqual(await locks.run('pairing:code-1', async () => {}), false);
  pairingTask.resolve();
  await pairing;
  assert.strictEqual(locks.isLocked('pairing:code-1'), false, 'pairing lock must clear in finally');

  const applicationTask = deferred();
  const application = locks.run('application:application-1', () => applicationTask.promise);
  assert.strictEqual(await locks.run('application:application-1', async () => {}), false, 'application review must reject duplicate actions');
  applicationTask.resolve();
  await application;
  assert.strictEqual(locks.isLocked('application:application-1'), false);
  console.log('miniapp admin review coordinator checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
