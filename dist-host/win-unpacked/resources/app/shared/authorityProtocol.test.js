const assert = require('assert');
const {
  PROTOCOL,
  authorityProtocolError,
  stableJson,
  validateEnvelope,
} = require('./authorityProtocol');

function envelope(overrides = {}) {
  return {
    protocol: PROTOCOL,
    commandId: 'command-1',
    idempotencyKey: 'idempotency-1',
    authorityId: 'authority-1',
    hostEpochId: 'epoch-1',
    actor: { userId: 'user-1', deviceId: 'device-1', role: 'teacher' },
    lease: { id: 'lease-1', grantVersion: 3 },
    type: 'schedule.update.v1',
    payload: { id: 'schedule-1' },
    payloadHash: 'payload-hash-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

const validated = validateEnvelope(envelope());
assert.strictEqual(validated.type, 'schedule.update.v1', 'accepts the single authority command protocol');
assert.strictEqual(validated.payloadHash, 'payload-hash-1', 'preserves the signed input hash across transports');
assert.strictEqual(validated.createdAt, '2026-07-28T00:00:00.000Z', 'preserves command creation time across transports');
assert.strictEqual(
  stableJson({ b: 1, a: { z: 3, y: 2 } }),
  stableJson({ a: { y: 2, z: 3 }, b: 1 }),
  'hash input is deterministic across transport adapters'
);
assert.throws(
  () => validateEnvelope(envelope({ protocol: 'legacy.raw-sync.v1' })),
  error => error?.code === 'AUTHORITY_PROTOCOL_INVALID',
  'rejects a legacy transport payload before host execution'
);
assert.throws(
  () => validateEnvelope(envelope({ lease: { id: '' } })),
  error => error?.code === 'AUTHORITY_ACTOR_OR_LEASE_REQUIRED',
  'requires a lease for every mutating command'
);
assert.throws(
  () => validateEnvelope(envelope({ payloadHash: '' })),
  error => error?.code === 'AUTHORITY_ENVELOPE_INVALID',
  'requires the signed payload hash'
);
assert.throws(
  () => validateEnvelope(envelope({ createdAt: 'not-a-date' })),
  error => error?.code === 'AUTHORITY_ENVELOPE_INVALID',
  'requires a canonical creation timestamp'
);
assert.strictEqual(authorityProtocolError('EXAMPLE').code, 'EXAMPLE');

console.log('authorityProtocol tests passed');
