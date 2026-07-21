'use strict';

const base = require('./package.json').build;

module.exports = {
  ...base,
  files: [
    ...base.files,
    'public/primaryHostCredentialStore.js',
    'public/primaryHostOperationValidation.js',
    'public/primaryHostRuntimeManager.js',
  ],
  directories: {
    ...base.directories,
    output: 'dist-host',
  },
  extraMetadata: {
    desktopBuildFlavor: 'primary-host',
  },
  artifactName: 'GewuGongfang-PrimaryHost-${version}-${arch}.${ext}',
  publish: [{
    provider: 'generic',
    url: 'https://gewu-staging-edu.oss-cn-beijing.aliyuncs.com/desktop-host/',
  }],
};
