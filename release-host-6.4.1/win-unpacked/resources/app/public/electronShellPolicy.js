'use strict';

function developmentMenuTemplate() {
  return [
    {
      label: 'Debug',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ];
}

function buildApplicationMenu({ isPackaged = true, menuApi } = {}) {
  if (isPackaged) return null;
  const descriptor = Object.freeze({
    debugOnly: true,
    template: Object.freeze(developmentMenuTemplate()),
  });
  if (!menuApi || typeof menuApi.buildFromTemplate !== 'function') return descriptor;
  const menu = menuApi.buildFromTemplate(descriptor.template);
  Object.defineProperty(menu, 'debugOnly', { value: true, enumerable: false });
  return menu;
}

function desktopWindowChrome() {
  return Object.freeze({ autoHideMenuBar: true, menuBarVisible: false });
}

function desktopUpdaterErrorMessage(error, phase = 'check') {
  const raw = String(error?.code || error?.message || error || '').toLowerCase();
  if (raw.includes('timeout')) return '\u66f4\u65b0\u68c0\u67e5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5';
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

module.exports = { buildApplicationMenu, desktopUpdaterErrorMessage, desktopWindowChrome };
