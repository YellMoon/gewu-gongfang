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
      authVersion: 7,
      credentialVersion: 3,
      rowVersion: 1,
    },
    profile: { userId: 'u1', user: { id: 'u1', name: '教师甲' }, teacherId: 'teacher-1' },
  };
  assert.strictEqual(typeof service.normalizeDesktopAuthorizationSession, 'function',
    'a host-issued sync session must be normalized without replacing the cloud runtime session');
  assert.strictEqual(
    service.normalizeDesktopAuthorizationSession(value).authContext.deviceId,
    'd1'
  );
  await service.saveDesktopAuthorizationSession(value, { storage, desktopIdentity });
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authorization, 'Bearer short-session-token');
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authContext.activeRole, 'teacher');
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authContext.sessionId, 'sid-1');
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authContext.authVersion, 7);
  assert.strictEqual(service.readDesktopAuthorizationSession(storage).authContext.credentialVersion, 3);
  assert.deepStrictEqual(storageWrites, [], 'short desktop sessions must remain in memory only');
  assert.strictEqual(ipcCalls.length, 0, 'saving a short session must not use raw credential IPC');

  const refreshedTeacher = service.normalizeDesktopAuthorizationSession({
    token: 'teacher-refresh-token',
    session: {
      id: 'sid-teacher-refresh', userId: 'u1', deviceId: 'd1', activeRole: 'teacher',
      eligibleRoles: ['super_admin', 'teacher'], teacherId: 'teacher-session-current', studentId: null,
    },
    profile: {
      userId: 'u1', activeRole: 'teacher', eligibleRoles: ['super_admin', 'teacher'],
      teacherId: 'teacher-profile-stale', studentId: 'student-profile-stale',
    },
    teacherId: 'teacher-top-level-stale',
    studentId: 'student-top-level-stale',
  });
  assert.strictEqual(refreshedTeacher.authContext.teacherId, 'teacher-session-current',
    'the newly issued session scope must win over stale profile and top-level fallbacks');
  assert.strictEqual(refreshedTeacher.authContext.studentId, null,
    'a teacher session must never retain a student scope');
  assert.strictEqual(refreshedTeacher.profile.teacherId, 'teacher-session-current');
  assert.strictEqual(refreshedTeacher.profile.studentId, null);

  const switchedAdmin = service.normalizeDesktopAuthorizationSession({
    token: 'admin-switch-token',
    session: {
      id: 'sid-admin-switch', userId: 'u1', deviceId: 'd1', activeRole: 'super_admin',
      eligibleRoles: ['super_admin', 'teacher'], teacherId: null, studentId: null,
    },
    profile: {
      userId: 'u1', activeRole: 'super_admin', eligibleRoles: ['super_admin', 'teacher'],
      teacherId: 'teacher-profile-stale', studentId: 'student-profile-stale',
    },
    teacherId: 'teacher-top-level-stale',
    studentId: 'student-top-level-stale',
  });
  assert.strictEqual(switchedAdmin.authContext.teacherId, null);
  assert.strictEqual(switchedAdmin.authContext.studentId, null);
  assert.strictEqual(switchedAdmin.profile.teacherId, null);
  assert.strictEqual(switchedAdmin.profile.studentId, null);

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
