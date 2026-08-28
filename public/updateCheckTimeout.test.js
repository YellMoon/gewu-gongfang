const assert = require('assert');
const fs = require('fs');
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
    electronMain.includes('scheduleDesktopUpdateCheck()'),
    'the desktop app must check its OSS update feed after startup rather than waiting for a manual settings action',
  );

  console.log('desktop updater timeout tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
