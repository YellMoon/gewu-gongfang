const assert = require('node:assert/strict');
const { createDesktopIdentityService } = require('./desktopIdentityService');

const rows = [
  {
    id: 'authorization-1',
    device_id: 'device-1',
    device_name: 'Desktop 1',
    device_kind: 'desktop-client',
    user_id: 'user-1',
    key_fingerprint: 'fingerprint-1',
    status: 'active',
    credential_version: 2,
    row_version: 3,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
  },
];
const calls = [];
const db = {
  prepare(sql) {
    return {
      all(...params) {
        calls.push({ sql, params });
        return rows;
      },
    };
  },
};

const service = createDesktopIdentityService({ db });
assert.deepEqual(service.listDevicesForUser('user-1'), [{
  id: 'authorization-1',
  deviceId: 'device-1',
  deviceName: 'Desktop 1',
  deviceKind: 'desktop-client',
  userId: 'user-1',
  keyFingerprint: 'fingerprint-1',
  status: 'active',
  approvedByUserId: null,
  approvedByDeviceId: null,
  approvedAt: null,
  lastPhoneVerifiedAt: null,
  phoneReverifyDueAt: null,
  credentialVersion: 2,
  lastSeenAt: null,
  rowVersion: 3,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  revokedAt: null,
  retiredAt: null,
  replacedByDeviceId: null,
}]);
assert.deepEqual(calls[0].params, ['user-1']);
assert.deepEqual(service.listAllDevices().map(item => item.deviceId), ['device-1']);
assert.throws(() => service.listDevicesForUser(''), error => error.code === 'DESKTOP_USER_ID_REQUIRED');

for (const retiredMethod of [
  'startChallenge',
  'confirmVerifiedIdentity',
  'listPendingAuthorizations',
  'approveChallenge',
  'rejectChallenge',
  'exchangeChallenge',
  'beginActivation',
]) {
  assert.equal(service[retiredMethod], undefined, `${retiredMethod} must remain retired`);
}

console.log('desktop identity device listing service tests passed');
