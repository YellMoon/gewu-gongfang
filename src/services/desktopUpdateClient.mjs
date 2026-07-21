export const DESKTOP_UPDATE_CHECK_TIMEOUT_CODE = 'UPDATE_CHECK_TIMEOUT';
export const DESKTOP_UPDATE_CHECK_TIMEOUT_MESSAGE =
  '\u66f4\u65b0\u68c0\u67e5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5';

export function desktopUpdateStateAfterCheck(previous, result = {}) {
  return {
    ...previous,
    checking: false,
    feedUrl: result.feedUrl || previous.feedUrl,
    latestVersion: result.updateInfo?.version || previous.latestVersion,
  };
}

export function invokeDesktopUpdateCheck(api, { timeoutMs = 30_000 } = {}) {
  if (!api || typeof api.invoke !== 'function') {
    return Promise.resolve({
      success: false,
      code: 'DESKTOP_UPDATE_BRIDGE_UNAVAILABLE',
      error: '\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u8f6f\u4ef6\u5185\u66f4\u65b0',
    });
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({
      success: false,
      code: DESKTOP_UPDATE_CHECK_TIMEOUT_CODE,
      error: DESKTOP_UPDATE_CHECK_TIMEOUT_MESSAGE,
    }), timeoutMs);
    Promise.resolve()
      .then(() => api.invoke('check-for-updates'))
      .then(finish, error => finish({
        success: false,
        error: String(error?.message || error || '\u68c0\u67e5\u66f4\u65b0\u5931\u8d25'),
      }));
  });
}
