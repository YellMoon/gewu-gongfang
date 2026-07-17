const { contextBridge, ipcRenderer } = require('electron');

const invokeAllowList = new Set([
  'get-app-version',
  'get-user-data-path',
  'runtime-config:get',
  'runtime-config:set',
  'dialog:select-folder',
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

contextBridge.exposeInMainWorld('desktopIdentity', Object.freeze({
  status: () => ipcRenderer.invoke('desktop-identity:status'),
  beginRegistration: input => ipcRenderer.invoke('desktop-identity:begin-registration', input),
  completeRegistration: input => ipcRenderer.invoke('desktop-identity:complete-registration', input),
  unlock: input => ipcRenderer.invoke('desktop-identity:unlock', input),
  lock: () => ipcRenderer.invoke('desktop-identity:lock'),
  signChallenge: input => ipcRenderer.invoke('desktop-identity:sign-challenge', input),
}));

contextBridge.exposeInMainWorld('env', {
  isProd: process.env.NODE_ENV === 'production',
});
contextBridge.exposeInMainWorld('questionDraftProvenance', {
  issueDraft: authorization => ipcRenderer.invoke('issue-question-draft', { authorization }),
  verifyDraft: (questionId, authorization) => ipcRenderer.invoke('verify-question-draft-provenance', { questionId, authorization }),
});
