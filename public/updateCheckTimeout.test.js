const assert = require('assert');
const fs = require('fs');
const { withOperationTimeout } = require('./updateCheckTimeout');
const { scheduleDesktopUpdateCheck } = require('./desktopUpdateScheduler');

(async () => {
  assert.strictEqual(
    await withOperationTimeout(Promise.resolve('ok'), 50, 'UPDATE_CHECK_TIMEOUT'),
    'ok',
  );

  await assert.rejects(
    withOperationTimeout(new Promise(() => {}), 10, 'UPDATE_CHECK_TIMEOUT'),
    error => error && error.code === 'UPDATE_CHECK_TIMEOUT' && error.message === 'UPDATE_CHECK_TIMEOUT',
  );

  const electronMain = fs.readFileSync('./public/electron.js', 'utf8');
  assert.ok(
    electronMain.includes('updateAvailable: result?.isUpdateAvailable === true'),
    'the updater IPC result must retain electron-updater availability rather than relying only on a renderer event',
  );
  assert.ok(
    electronMain.includes('autoUpdater.autoDownload = true'),
    'the desktop app must download an available verified update without requiring the user to open settings',
  );
  assert.ok(
    electronMain.includes('autoUpdater.autoInstallOnAppQuit = true'),
    'a downloaded desktop update must install when the user normally closes the app',
  );
  assert.ok(
    electronMain.includes('scheduleDesktopUpdateCheck({'),
    'the desktop app must check its OSS update feed after startup rather than waiting for a manual settings action',
  );

  let scheduledCheck = null;
  const synchronousFailures = [];
  assert.strictEqual(scheduleDesktopUpdateCheck({
    isPackaged: true,
    updater: { checkForUpdates() { throw new Error('sync updater failure'); } },
    timeoutRunner: () => { throw new Error('must not run after a synchronous updater failure'); },
    log: message => synchronousFailures.push(message),
    setTimer: (callback, delay) => { scheduledCheck = callback; assert.strictEqual(delay, 4000); },
  }), true);
  assert.strictEqual(typeof scheduledCheck, 'function');
  scheduledCheck();
  assert.deepStrictEqual(synchronousFailures, ['Desktop update check failed sync updater failure']);

  let scheduledRejection = null;
  const asynchronousFailures = [];
  scheduleDesktopUpdateCheck({
    isPackaged: true,
    updater: { checkForUpdates() { return Promise.resolve('update-check'); } },
    timeoutRunner: () => Promise.reject(new Error('async updater failure')),
    log: message => asynchronousFailures.push(message),
    setTimer: callback => { scheduledRejection = callback; },
  });
  scheduledRejection();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(asynchronousFailures, ['Desktop update check failed async updater failure']);

  assert.strictEqual(scheduleDesktopUpdateCheck({
    isPackaged: false,
    updater: { checkForUpdates() { throw new Error('should not execute'); } },
    timeoutRunner: () => undefined,
    log: () => undefined,
    setTimer: () => { throw new Error('development builds must not schedule updates'); },
  }), false);

  console.log('desktop updater timeout tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
