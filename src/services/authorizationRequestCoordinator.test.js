const assert = require('assert');

(async () => {
  const { createLatestRequestCoordinator } = await import('./authorizationRequestCoordinator.mjs');
  const coordinator = createLatestRequestCoordinator();
  const events = [];
  let resolveFirst;
  let resolveSecond;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const second = new Promise(resolve => { resolveSecond = resolve; });
  const firstRun = coordinator.run(() => first, {
    success: value => events.push(`success:${value}`),
    error: error => events.push(`error:${error.message}`),
    settled: () => events.push('settled:first'),
  });
  const secondRun = coordinator.run(() => second, {
    success: value => events.push(`success:${value}`),
    error: error => events.push(`error:${error.message}`),
    settled: () => events.push('settled:second'),
  });
  resolveSecond('new');
  await secondRun;
  resolveFirst('old');
  await firstRun;
  assert.deepStrictEqual(events, ['success:new', 'settled:second']);

  const thirdRun = coordinator.run(() => Promise.reject(new Error('latest')), {
    success: () => events.push('unexpected'), error: error => events.push(`error:${error.message}`), settled: () => events.push('settled:third'),
  });
  await thirdRun;
  assert.deepStrictEqual(events.slice(-2), ['error:latest', 'settled:third']);
  console.log('authorization request coordinator tests passed');
})().catch(error => { console.error(error); process.exit(1); });
