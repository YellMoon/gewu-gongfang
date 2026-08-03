'use strict';

const assert = require('assert');
const fs = require('fs');
const { acquireDesktopSingleInstance } = require('./electronSingleInstance');

function mockApp(acquired) {
  const listeners = new Map();
  const quits = [];
  return {
    app: {
      requestSingleInstanceLock() { return acquired; },
      on(name, listener) { listeners.set(name, listener); },
      quit() { quits.push(true); },
    },
    listeners,
    quits,
  };
}

{
  const runtime = mockApp(false);
  assert.strictEqual(acquireDesktopSingleInstance({ app: runtime.app, getWindow: () => null }), false);
  assert.deepStrictEqual(runtime.quits, [true]);
  assert.strictEqual(runtime.listeners.has('second-instance'), false,
    'a non-owner process must exit before registering application lifecycle handlers');
}

{
  const runtime = mockApp(true);
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  assert.strictEqual(acquireDesktopSingleInstance({ app: runtime.app, getWindow: () => window }), true);
  runtime.listeners.get('second-instance')();
  assert.deepStrictEqual(calls, ['restore', 'show', 'focus']);
  assert.deepStrictEqual(runtime.quits, []);
}

{
  const runtime = mockApp(true);
  assert.strictEqual(acquireDesktopSingleInstance({ app: runtime.app, getWindow: () => null }), true);
  assert.doesNotThrow(() => runtime.listeners.get('second-instance')());
}

const electronSource = fs.readFileSync('public/electron.js', 'utf8');
const packageJson = require('../package.json');
assert.ok(electronSource.includes("require('./electronSingleInstance')"));
assert.ok(electronSource.includes('acquireDesktopSingleInstance({'));
assert.ok(electronSource.includes('if (DESKTOP_SINGLE_INSTANCE_OWNER) {')
  && electronSource.includes('Promise.all([app.whenReady(), crossInstallInstanceLock.ready])')
  && electronSource.includes('if (!crossInstallOwner) return;'),
  'only the built-in and cross-install lock owner may start the backend and window');
assert.ok(electronSource.indexOf('acquireDesktopSingleInstance({') < electronSource.indexOf("const logDir = path.join(app.getPath('userData')"),
  'single-instance ownership must be resolved before logs, vaults, or the embedded backend use the shared profile');
assert.ok(packageJson.build.files.includes('public/electronSingleInstance.js'),
  'both desktop package flavors must contain the single-instance guard');

console.log('Electron single-instance checks passed');
