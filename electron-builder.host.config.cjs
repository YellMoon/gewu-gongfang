'use strict';

const base = require('./package.json').build;

module.exports = {
  ...base,
  files: [
    ...base.files,
    'public/primaryHostCredentialStore.js',
    'public/primaryHostOperationValidation.js',
    'public/primaryHostRuntimeManager.js',
    'public/primaryHostRuntimeStatus.js',
    'public/primaryHostRelaunchReadiness.js',
    'public/windowsHostFirewallElevated.ps1',
  ],
  directories: {
    ...base.directories,
    output: 'dist-host',
  },
  extraMetadata: {
    desktopBuildFlavor: 'primary-host',
    desktopCapabilityManifest: { flavor: 'primary-host', revision: 1 },
  },
  artifactName: 'GewuGongfang-PrimaryHost-${version}-${arch}.${ext}',
  publish: [{
    provider: 'generic',
    url: 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop/host/',
  }],
  // dist:win:host has already rebuilt native modules for Electron. Re-running
  // that step inside electron-builder can leave a stale host package behind.
  npmRebuild: false,
};
