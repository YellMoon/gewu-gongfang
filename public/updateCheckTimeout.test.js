const assert = require('assert');
const { withOperationTimeout } = require('./updateCheckTimeout');

(async () => {
  assert.strictEqual(
    await withOperationTimeout(Promise.resolve('ok'), 50, 'UPDATE_CHECK_TIMEOUT'),
    'ok',
  );

  await assert.rejects(
    withOperationTimeout(new Promise(() => {}), 10, 'UPDATE_CHECK_TIMEOUT'),
    error => error && error.code === 'UPDATE_CHECK_TIMEOUT' && error.message === 'UPDATE_CHECK_TIMEOUT',
  );

  console.log('desktop updater timeout tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
