export const DESKTOP_UPDATE_CHECK_TIMEOUT_CODE = 'UPDATE_CHECK_TIMEOUT';
export const DESKTOP_UPDATE_CHECK_TIMEOUT_MESSAGE =
  '\u66f4\u65b0\u68c0\u67e5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5';

export function desktopUpdateErrorMessage(error, phase = 'check') {
  const raw = String(error?.code || error?.message || error || '').toLowerCase();
  if (raw.includes('timeout')) return DESKTOP_UPDATE_CHECK_TIMEOUT_MESSAGE;
  if (/checksum|sha512|signature|integrity/.test(raw)) return '\u66f4\u65b0\u5305\u6821\u9a8c\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u4e0b\u8f7d';
  if (/network|enotfound|econn|err_name_not_resolved|err_internet_disconnected|socket|fetch/.test(raw)) {
    return '\u65e0\u6cd5\u8fde\u63a5\u66f4\u65b0\u670d\u52a1\u5668\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5';
  }
  if (/version|downgrade|not newer/.test(raw)) return '\u66f4\u65b0\u7248\u672c\u4e0d\u9002\u7528\u4e8e\u5f53\u524d\u5b89\u88c5\u5305';
  if (raw.includes('unavailable')) return '\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u8f6f\u4ef6\u5185\u66f4\u65b0';
  return phase === 'download'
    ? '\u4e0b\u8f7d\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'
    : phase === 'install'
      ? '\u5b89\u88c5\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u91cd\u542f\u8f6f\u4ef6\u540e\u91cd\u8bd5'
      : '\u68c0\u67e5\u66f4\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
}

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
        error: desktopUpdateErrorMessage(error, 'check'),
      }));
  });
}
