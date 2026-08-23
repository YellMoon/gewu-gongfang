const { contextBridge, ipcRenderer } = require('electron');
const desktopBuildFlavor = 'unified-desktop';

const invokeAllowList = new Set([
  'get-app-version',
  'get-user-data-path',
  'runtime-config:get',
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
  beginUnifiedOnlineRegistration: input => ipcRenderer.invoke('desktop-identity:begin-unified-online-registration', input),
  completeRegistration: input => ipcRenderer.invoke('desktop-identity:complete-registration', input),
  resume: () => ipcRenderer.invoke('desktop-identity:resume'),
  lock: () => ipcRenderer.invoke('desktop-identity:lock'),
  refreshOfflineLease: input => ipcRenderer.invoke('desktop-identity:refresh-offline-lease', input),
  signChallenge: input => ipcRenderer.invoke('desktop-identity:sign-challenge', input),
}));

contextBridge.exposeInMainWorld('desktopAuthority', Object.freeze({
  appendDraft: input => ipcRenderer.invoke('desktop-authority:append-draft', input),
  appendDraftSync: input => {
    const result = ipcRenderer.sendSync('desktop-authority:append-draft-sync', input);
    if (!result?.ok) {
      const error = new Error(result?.error?.code || 'AUTHORITY_DRAFT_APPEND_FAILED');
      error.code = result?.error?.code || 'AUTHORITY_DRAFT_APPEND_FAILED';
      throw error;
    }
    return result.item;
  },
  appendDraftBatchSync: inputs => {
    const result = ipcRenderer.sendSync('desktop-authority:append-draft-batch-sync', inputs);
    if (!result?.ok) {
      const error = new Error(result?.error?.code || 'AUTHORITY_DRAFT_BATCH_APPEND_FAILED');
      error.code = result?.error?.code || 'AUTHORITY_DRAFT_BATCH_APPEND_FAILED';
      throw error;
    }
    return result.items;
  },
  get: id => ipcRenderer.invoke('desktop-authority:get', id),
  list: () => ipcRenderer.invoke('desktop-authority:list'),
  readProjection: input => ipcRenderer.invoke('desktop-authority:read-projection', input),
  submit: (id, input) => ipcRenderer.invoke('desktop-authority:submit', id, input),
  confirmAndSubmit: (id, input) => ipcRenderer.invoke('desktop-authority:confirm-and-submit', id, input),
}));

contextBridge.exposeInMainWorld('desktopBuild', Object.freeze({
  flavor: desktopBuildFlavor,
}));

contextBridge.exposeInMainWorld('env', {
  isProd: process.env.NODE_ENV === 'production',
});
contextBridge.exposeInMainWorld('questionDraftProvenance', {
  issueDraft: authorization => ipcRenderer.invoke('issue-question-draft', { authorization }),
  verifyDraft: (questionId, authorization) => ipcRenderer.invoke('verify-question-draft-provenance', { questionId, authorization }),
});
contextBridge.exposeInMainWorld('questionImportRelay', Object.freeze({
  sealSource: input => ipcRenderer.invoke('seal-question-import-source', input),
  sealAsset: input => ipcRenderer.invoke('seal-question-asset', input),
}));
