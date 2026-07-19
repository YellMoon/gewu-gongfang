const assert = require('assert');

(async () => {
  const {
    desktopUpdateStateAfterCheck,
    invokeDesktopUpdateCheck,
  } = await import('./desktopUpdateClient.mjs');

  assert.deepStrictEqual(
    await invokeDesktopUpdateCheck({ invoke: async () => ({ success: true }) }, { timeoutMs: 50 }),
    { success: true },
  );

  const timedOut = await invokeDesktopUpdateCheck(
    { invoke: async () => new Promise(() => {}) },
    { timeoutMs: 10 },
  );
  assert.strictEqual(timedOut.success, false);
  assert.strictEqual(timedOut.code, 'UPDATE_CHECK_TIMEOUT');
  assert.strictEqual(timedOut.error, '\u66f4\u65b0\u68c0\u67e5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5');

  assert.deepStrictEqual(
    desktopUpdateStateAfterCheck(
      { checking: true, available: false, progress: 0 },
      { success: true, feedUrl: 'https://oss.example/desktop/', updateInfo: null },
    ),
    {
      checking: false,
      available: false,
      progress: 0,
      feedUrl: 'https://oss.example/desktop/',
      latestVersion: undefined,
    },
  );

  console.log('desktop update client tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
