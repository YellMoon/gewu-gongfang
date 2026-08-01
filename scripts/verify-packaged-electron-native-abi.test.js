'use strict';

const assert = require('assert');
const verifier = require('./verify-packaged-electron-native-abi');
const packageJson = require('../package.json');

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

for (const scriptName of ['dist', 'pack', 'dist:win', 'dist:win:host']) {
  const command = packageJson.scripts[scriptName];
  assert.match(
    command,
    /PACKAGED_APP_ROOT=[^&]*\\win-unpacked\\resources\\app/i,
    `${scriptName} must pass the packaged resources/app directory to the ABI verifier`
  );
}

console.log('packaged Electron native ABI verifier checks passed');
