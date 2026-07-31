'use strict';

const assert = require('assert');

const verifier = require('./verify-packaged-electron-native-abi');

assert.throws(
  () => verifier.resolvePackagedPaths({ appRoot: '', executable: '' }),
  /PACKAGED_APP_ROOT/i,
  'the packaged ABI verifier must fail closed without an explicit unpacked app root'
);

const paths = verifier.resolvePackagedPaths({
  appRoot: 'C:\\fixture\\win-unpacked\\resources\\app',
  executable: 'C:\\fixture\\win-unpacked\\app.exe',
});
assert.strictEqual(paths.appRoot, 'C:\\fixture\\win-unpacked\\resources\\app');
assert.strictEqual(paths.executable, 'C:\\fixture\\win-unpacked\\app.exe');
assert.strictEqual(
  verifier.isPackagedElectronChild({ GEWU_PACKAGED_ABI_CHILD: '1' }),
  true,
  'the verifier must distinguish the child that runs under the packaged Electron runtime'
);

console.log('packaged Electron native ABI verifier checks passed');
