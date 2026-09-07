'use strict';

const assert = require('assert');
const verifier = require('./verify-packaged-electron-native-abi');
const packageJson = require('../package.json');
const path = require('path');

const checked = [];
class FakeDatabase { prepare() { return { get: () => ({ ok: 1 }) }; } close() {} }
assert.throws(() => verifier.verifyPackagedNativeModule({ appRoot: path.resolve('fixture-app'), createRequire: entry => {
  checked.push(entry);
  return () => { if (entry.includes(`${path.sep}backend${path.sep}`)) throw new Error('BACKEND_ABI_MISMATCH'); return FakeDatabase; };
}, log: () => {} }), /BACKEND_ABI_MISMATCH/, 'a working root binary must not hide an incompatible nested backend binary');
assert.equal(checked.length, 2);
assert(packageJson.scripts['rebuild:node'].includes('npm --prefix backend rebuild better-sqlite3'), 'Node restore must cover the backend copy');
assert(packageJson.scripts['rebuild:electron'].includes('rebuild-backend-electron-deps.js'), 'Electron preparation must cover the backend copy');

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

for (const scriptName of ['dist', 'pack', 'dist:win']) {
  const command = packageJson.scripts[scriptName];
  assert.match(
    command,
    /PACKAGED_APP_ROOT=[^&]*\\win-unpacked\\resources\\app/i,
    `${scriptName} must pass the packaged resources/app directory to the ABI verifier`
  );
}

console.log('packaged Electron native ABI verifier checks passed');
