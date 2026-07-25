'use strict';

const automator = require('../output/miniapp-automation/node_modules/miniprogram-automator');

(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: process.argv[2] || 'ws://127.0.0.1:9432' });
  try {
    await miniProgram.mockWxMethod(
      'getStorageSync',
      (key, values) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '',
      { '__codex_probe__': 'mock-ok' },
    );
    const value = await miniProgram.callWxMethod('getStorageSync', '__codex_probe__');
    await miniProgram.mockWxMethod('request', (options) => {
      const response = { statusCode: 200, data: { success: true, data: { probe: 'request-ok' } }, header: {} };
      globalThis.__codexRequestProbe = {
        optionKeys: Object.keys(options || {}).sort(),
        successType: typeof options?.success,
        completeType: typeof options?.complete,
      };
      if (typeof options.success === 'function') options.success(response);
      if (typeof options.complete === 'function') options.complete(response);
      return response;
    });
    const requestValue = await miniProgram.callWxMethod('request', { url: 'https://fixture.invalid/probe' });
    await miniProgram.evaluate(() => {
      globalThis.__codexRequestSuccess = null;
      wx.request({
        url: 'https://fixture.invalid/probe-from-app',
        success: (response) => { globalThis.__codexRequestSuccess = response; },
      });
      return true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const appRequestProbe = await miniProgram.evaluate(() => ({
      observed: globalThis.__codexRequestProbe || null,
      success: globalThis.__codexRequestSuccess || null,
    }));
    console.log(JSON.stringify({
      storageMocked: value === 'mock-ok',
      requestMocked: requestValue?.data?.data?.probe === 'request-ok',
      requestShape: requestValue,
      appRequestProbe,
    }));
  } finally {
    try { await miniProgram.restoreWxMethod('request'); } catch (_error) { /* best effort */ }
    try { await miniProgram.restoreWxMethod('removeStorageSync'); } catch (_error) { /* best effort */ }
    try { await miniProgram.restoreWxMethod('setStorageSync'); } catch (_error) { /* best effort */ }
    try { await miniProgram.restoreWxMethod('getStorageSync'); } catch (_error) { /* best effort */ }
    miniProgram.disconnect();
  }
})().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
