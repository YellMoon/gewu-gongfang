const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createSessionBoundNetworkSyncListener } = require('./miniappStartupSyncRuntime');

async function run() {
  const listeners = new Set();
  const onNetworkStatusChange = (listener) => listeners.add(listener);
  const offNetworkStatusChange = (listener) => {
    assert.strictEqual(typeof listener, 'function', 'listener cleanup must never call the no-argument global removal');
    listeners.delete(listener);
  };
  const emit = async (event) => {
    await Promise.all(Array.from(listeners, (listener) => listener(event)));
  };

  const startupSession = { token: 'normal-token', identity: { id: 'admin-1' } };
  let currentSession = startupSession;
  const pullCalls = [];
  const disposeApp = createSessionBoundNetworkSyncListener({
    startupSession,
    isSameSession: (session) => session === currentSession,
    captureTrustedAuthSession: () => currentSession,
    isReviewExperienceIdentity: () => false,
    onNetworkStatusChange,
    offNetworkStatusChange,
    pull: async (token) => { pullCalls.push(token); },
  });

  const settingsEvents = [];
  const settingsNetworkStatusCallback = (event) => settingsEvents.push(event.isConnected);
  onNetworkStatusChange(settingsNetworkStatusCallback);
  const disposeSettings = () => offNetworkStatusChange(settingsNetworkStatusCallback);

  assert.strictEqual(listeners.size, 2, 'app and settings listeners must coexist');
  await emit({ isConnected: true });
  assert.deepStrictEqual(pullCalls, ['normal-token']);
  assert.deepStrictEqual(settingsEvents, [true]);

  disposeSettings();
  assert.strictEqual(listeners.size, 1, 'unmounting settings must remove only the settings callback');
  await emit({ isConnected: true });
  assert.deepStrictEqual(pullCalls, ['normal-token', 'normal-token'], 'the app listener must still pull after settings unmount');
  assert.deepStrictEqual(settingsEvents, [true], 'the disposed settings listener must stay inactive');

  disposeApp();
  assert.strictEqual(listeners.size, 0, 'app listener cleanup must still remove its own callback');
  await emit({ isConnected: true });
  assert.strictEqual(pullCalls.length, 2);

  const settingsSource = fs.readFileSync(path.resolve(__dirname, '../pages/settings/index.tsx'), 'utf8');
  assert.ok(settingsSource.includes('const handleNetworkStatusChange ='));
  assert.ok(settingsSource.includes('onNetworkStatusChange(handleNetworkStatusChange)'));
  assert.ok(settingsSource.includes('offNetworkStatusChange(handleNetworkStatusChange)'));
  assert.strictEqual(/offNetworkStatusChange\s*\(\s*\)/.test(settingsSource), false);
  void currentSession;
}

run().then(() => {
  console.log('miniapp network listener isolation tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
