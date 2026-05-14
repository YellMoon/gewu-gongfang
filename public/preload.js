const { contextBridge, ipcRenderer } = require('electron');

const invokeAllowList = new Set([
  'get-app-version',
  'get-user-data-path',
  'open-external',
  'check-for-updates',
  'download-update',
  'install-update',
]);

const eventAllowList = new Set([
  'update-available',
  'update-not-available',
  'update-downloaded',
  'update-error',
  'download-progress',
]);

contextBridge.exposeInMainWorld('api', {
  invoke(channel, ...args) {
    if (!invokeAllowList.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!eventAllowList.has(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});

contextBridge.exposeInMainWorld('env', {
  isProd: process.env.NODE_ENV === 'production',
});
