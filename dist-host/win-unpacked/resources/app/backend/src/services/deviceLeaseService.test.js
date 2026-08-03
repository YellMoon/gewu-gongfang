const assert = require('assert');
const { createDeviceLeaseService } = require('./deviceLeaseService');

const service = createDeviceLeaseService({
  secret: 'test-secret-lease-key',
  now: () => new Date('2026-07-27T00:00:00.000Z'),
  randomId: () => 'lease-1',
});
const lease = service.issue({
  userId: 'u1',
  deviceId: 'd1',
  authorityId: 'authority-1',
  grantVersion: 3,
  activeRole: 'teacher',
  scope: { kind: 'teacher', teacherId: 't1' },
  durationMs: 30 * 60 * 1000,
});
assert.equal(lease.id, 'lease-1');
assert.equal(Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt), 30 * 60 * 1000);
assert.equal(service.verify(lease).deviceId, 'd1');
assert.throws(
  () => service.issue({ userId: 'u1', deviceId: 'd1', authorityId: 'authority-1', grantVersion: 3, activeRole: 'teacher', scope: {}, durationMs: 61 * 60 * 1000 }),
  error => error && error.code === 'DEVICE_LEASE_DURATION_INVALID'
);
assert.throws(
  () => service.verify({ ...lease, grantVersion: 4 }),
  error => error && error.code === 'DEVICE_LEASE_SIGNATURE_INVALID'
);

console.log('deviceLeaseService tests passed');
