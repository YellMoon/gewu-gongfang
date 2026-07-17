const assert = require('assert');

async function main() {
  const service = await import('./desktopAuthorizationSession.mjs');
  const values = new Map();
  const storageWrites = [];
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { storageWrites.push([key, value]); values.set(key, value); },
    removeItem: key => values.delete(key),
  };
  const ipcCalls = [];
  const desktopIdentity = {
    status: async () => ({ state: 'sealed', sealed: true, unlocked: false }),
    lock: async () => { ipcCalls.push('lock'); },
  };
  assert.throws(() => service.readDesktopAuthorizationSession({ getItem: () => null }), error => error.code === 'AUTHORIZATION_CONTEXT_REQUIRED');
  const value = {
    token: 'short-session-token',
    expiresAt: '2026-07-17T18:00:00.000Z',
    session: {
      id: 'sid-1',
      userId: 'u1',
      deviceId: 'd1',
      eligibleRoles: ['super_admin', 'teacher'],
      activeRole: 'teacher',
      rowVersion: 1,
    },
    profile: { userId: 'u1', user: { id: 'u1', name: '教师甲' }, teacherId: 'teacher-1' },
  };
  await service.saveDesktopAuthorizationSession(value, { storage, desktopIdentity });
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authorization, 'Bearer short-session-token');
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authContext.activeRole, 'teacher');
  assert.deepStrictEqual(storageWrites, [], 'short desktop sessions must remain in memory only');
  assert.strictEqual(ipcCalls.length, 0, 'saving a short session must not use raw credential IPC');

  await service.clearDesktopAuthorizationSession({ storage, desktopIdentity, lockVault: true });
  assert.deepStrictEqual(ipcCalls, ['lock']);
  assert.throws(
    () => service.readDesktopAuthorizationSession(storage),
    error => error.code === 'AUTHORIZATION_CONTEXT_REQUIRED'
  );

  values.set(service.desktopAuthorizationSessionKey, JSON.stringify({ token: 'legacy', userId: 'u2', deviceId: 'd2' }));
  await assert.rejects(
    service.hydrateDesktopAuthorizationSession({ storage, desktopIdentity }),
    error => error.code === 'DESKTOP_IDENTITY_UPGRADE_REQUIRED'
  );
  assert.strictEqual(values.has(service.desktopAuthorizationSessionKey), false);
  assert.strictEqual(storageWrites.length, 0, 'V1 tokens must never be auto-migrated to V2 storage');
  assert.strictEqual(typeof service.startPairing, 'undefined', 'V1 desktop pairing must no longer be callable');
  assert.strictEqual(typeof service.pollOrExchange, 'undefined', 'V1 exchange must no longer be callable');
  console.log('desktop authorization session tests passed');
}
main().catch(error => { console.error(error); process.exit(1); });
