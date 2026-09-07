'use strict';

require('./verify-packaged-electron-native-abi').verifyPackagedNativeModule({
  appRoot: require('path').resolve(__dirname, '..'),
});
