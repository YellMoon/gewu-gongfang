const { contextBridge, ipcRenderer } = require('electron');
const desktopRuntimeArguments = Array.isArray(process.argv) ? process.argv : [];
const desktopBuildFlavor = String(
  desktopRuntimeArguments.find(value => value.startsWith('--gewu-desktop-build-flavor=')) || ''
).split('=')[1] === 'primary-host' ? 'primary-host' : 'desktop-client';

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
  beginPasswordReset: () => ipcRenderer.invoke('desktop-identity:begin-password-reset'),
  completeRegistration: input => ipcRenderer.invoke('desktop-identity:complete-registration', input),
  completePasswordReset: input => ipcRenderer.invoke('desktop-identity:complete-password-reset', input),
  unlock: input => ipcRenderer.invoke('desktop-identity:unlock', input),
  lock: () => ipcRenderer.invoke('desktop-identity:lock'),
  refreshOfflineLease: input => ipcRenderer.invoke('desktop-identity:refresh-offline-lease', input),
  signChallenge: input => ipcRenderer.invoke('desktop-identity:sign-challenge', input),
}));

contextBridge.exposeInMainWorld('desktopBuild', Object.freeze({
  flavor: desktopBuildFlavor,
  primaryHostCapable: desktopBuildFlavor === 'primary-host',
}));

if (desktopBuildFlavor === 'primary-host') {
  contextBridge.exposeInMainWorld('primaryHostRuntime', Object.freeze({
    status: () => ipcRenderer.invoke('primary-host:status'),
    adopt: input => ipcRenderer.invoke('primary-host:adopt', input),
    demote: input => ipcRenderer.invoke('primary-host:demote', input),
    issueLocalReceipt: input => ipcRenderer.invoke('primary-host:local-receipt', input),
    prepareOperation: input => ipcRenderer.invoke('primary-host:prepare-operation', input),
    revealRecoveryPackage: input => ipcRenderer.invoke('primary-host:reveal-recovery-package', input),
    acknowledgeRecoveryPackage: input => ipcRenderer.invoke('primary-host:acknowledge-recovery-package', input),
    restart: () => ipcRenderer.invoke('primary-host:restart'),
  }));
}

contextBridge.exposeInMainWorld('env', {
  isProd: process.env.NODE_ENV === 'production',
});
contextBridge.exposeInMainWorld('questionDraftProvenance', {
  issueDraft: authorization => ipcRenderer.invoke('issue-question-draft', { authorization }),
  verifyDraft: (questionId, authorization) => ipcRenderer.invoke('verify-question-draft-provenance', { questionId, authorization }),
});
