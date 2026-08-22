const assert = require('assert');
const fs = require('fs');

(async () => {
  const source = fs.readFileSync('src/services/identityDeviceCenterPolicy.mjs', 'utf8');
  const {
    buildRevocationBody,
    identityDeviceCenterAccess,
    loadIdentityDeviceCenter,
    revokeDesktopDevice,
  } = await import('./identityDeviceCenterPolicy.mjs');
  const session = {
    authorization: 'Bearer session-token',
    authContext: { userId: 'user-1', deviceId: 'device-1', activeRole: 'super_admin', eligibleRoles: ['super_admin'] },
  };
  assert.deepStrictEqual(identityDeviceCenterAccess({ session }), {
    visible: true, canReview: true, canViewAllDevices: true, canRevoke: true,
    activeRole: 'super_admin', eligibleRoles: ['super_admin'], userId: 'user-1', deviceId: 'device-1', teacherId: null,
  });
  assert.ok(!source.includes('primary-host'));
  assert.ok(!source.includes('/authorizations/pending'));
  assert.ok(!source.includes('/primary-host/'));

  const calls = [];
  const snapshot = await loadIdentityDeviceCenter({
    baseUrl: 'https://cloud.example', session,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ success: true, data: { items: [{ deviceId: 'device-1', deviceName: 'Current', status: 'active', rowVersion: 1 }] } }) };
    },
  });
  assert.strictEqual(snapshot.mine.length, 1);
  assert.strictEqual(snapshot.mine[0].isCurrent, true);
  assert.strictEqual(snapshot.mine[0].canRevoke, false);
  assert.strictEqual(calls[0].url, 'https://cloud.example/api/desktop-identity/devices');

  assert.deepStrictEqual(buildRevocationBody({ deviceId: 'device-2', rowVersion: 4 }), {
    deviceId: 'device-2', expectedRowVersion: 4, reason: 'user_request',
  });
  calls.length = 0;
  await revokeDesktopDevice({
    baseUrl: 'https://cloud.example', session,
    request: { deviceId: 'device-2', expectedRowVersion: 4, reason: 'user_request' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ success: true, data: {} }) };
    },
  });
  assert.strictEqual(calls[0].url, 'https://cloud.example/api/desktop-identity/devices/device-2/revoke');
  assert.deepStrictEqual(JSON.parse(calls[0].options.body), { expectedRowVersion: 4, reason: 'user_request' });
  console.log('unified identity device center policy checks passed');
})().catch(error => { console.error(error); process.exit(1); });
