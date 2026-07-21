const assert = require('assert');

let createSessionBoundNetworkSyncListener;
try {
  ({ createSessionBoundNetworkSyncListener } = require('./miniappStartupSyncRuntime'));
} catch (_error) {
  // The first TDD run intentionally reaches this assertion before the runtime exists.
}

assert.strictEqual(
  typeof createSessionBoundNetworkSyncListener,
  'function',
  'startup sync must expose a session-bound network listener',
);

function unrecognizedIdentity(sessionId = 'unrecognized-1') {
  return {
    id: sessionId,
    role: 'student',
    user_type: 'student',
    account_state: 'unrecognized',
    token_use: 'unrecognized-student',
  };
}

function createHarness() {
  const startupSession = {
    generation: 7,
    token: 'normal-token',
    identity: { id: 'admin-1', role: 'admin', user_type: 'admin' },
  };
  let currentSession = startupSession;
  let listener = null;
  let offCalls = 0;
  const pullCalls = [];

  const dispose = createSessionBoundNetworkSyncListener({
    startupSession,
    isSameSession: (session) => session === currentSession,
    captureTrustedAuthSession: () => currentSession,
    isExperienceOnlyIdentity: (identity) => identity?.account_state === 'unrecognized',
    onNetworkStatusChange: (callback) => { listener = callback; },
    offNetworkStatusChange: (callback) => {
      assert.strictEqual(callback, listener);
      offCalls += 1;
      listener = null;
    },
    pull: async (token) => { pullCalls.push(token); },
  });

  return {
    dispose,
    pullCalls,
    getOffCalls: () => offCalls,
    async reconnect() {
      const activeListener = listener;
      if (activeListener) await activeListener({ isConnected: true });
    },
    async disconnect() {
      const activeListener = listener;
      if (activeListener) await activeListener({ isConnected: false });
    },
    switchToExperience() {
      currentSession = {
        generation: 8,
        token: 'experience-token',
        identity: unrecognizedIdentity(),
      };
    },
    mutateCurrentSessionToExperience() {
      currentSession.token = 'experience-token';
      currentSession.identity = unrecognizedIdentity('same-generation-experience');
    },
  };
}

async function run() {
  const normal = createHarness();
  await normal.disconnect();
  assert.deepStrictEqual(normal.pullCalls, [], 'offline events must not pull');
  await normal.reconnect();
  assert.deepStrictEqual(normal.pullCalls, ['normal-token'], 'the same normal session must still pull');
  assert.strictEqual(normal.getOffCalls(), 0, 'a valid normal session listener stays active');

  const race = createHarness();
  race.switchToExperience();
  await race.reconnect();
  assert.deepStrictEqual(
    race.pullCalls,
    [],
    'a listener created by a previous normal startup must never pull after switching to account experience',
  );
  assert.strictEqual(race.getOffCalls(), 1, 'an invalidated startup listener must unsubscribe itself');
  race.dispose();
  assert.strictEqual(race.getOffCalls(), 1, 'listener disposal must be idempotent');

  const experienceGuard = createHarness();
  experienceGuard.mutateCurrentSessionToExperience();
  await experienceGuard.reconnect();
  assert.deepStrictEqual(experienceGuard.pullCalls, [], 'the callback must independently reject an unrecognized identity');
  assert.strictEqual(experienceGuard.getOffCalls(), 1, 'an unrecognized identity must dispose the normal startup listener');
}

run().then(() => {
  console.log('miniappStartupSyncRuntime tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
