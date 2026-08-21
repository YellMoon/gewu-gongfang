'use strict';

const assert = require('node:assert');
const {
  createVNextUnifiedDesktopRegistrationReference,
} = require('./vNextUnifiedDesktopRegistrationReference');

const NOW = '2026-08-21T08:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function presentation(eventId, overrides = {}) {
  return {
    authorityId: 'authority-1',
    accountId: 'account-1',
    verificationEventId: eventId,
    audience: 'gewu-unified-desktop-registration',
    nonce: `nonce-${eventId}`,
    verifiedAt: '2026-08-21T07:59:00.000Z',
    expiresAt: '2026-08-21T08:04:00.000Z',
    assertionEvidenceSha256: 'e'.repeat(64),
    ...overrides,
  };
}

function command(eventId, overrides = {}) {
  return {
    type: 'desktop.installation.register',
    accountPresentation: `presentation-${eventId}`,
    verificationNonce: `nonce-${eventId}`,
    installationId: 'installation-1',
    installationPublicKey: 'test-ed25519-public-key',
    installationKeyFingerprint: HASH_A,
    logicalRequestSha256: 'c'.repeat(64),
    deviceChallenge: `challenge-${eventId}`,
    deviceProof: `proof-${eventId}`,
    idempotencyKey: `attempt-${eventId}`,
    ...overrides,
  };
}

function makeReference() {
  let sequence = 0;
  return createVNextUnifiedDesktopRegistrationReference({
    now: () => NOW,
    sessionTtlMs: 60 * 60 * 1000,
    idFactory: kind => `${kind}-${++sequence}`,
    verifyAccountPresentation: value => {
      const eventId = String(value).replace('presentation-', '');
      if (eventId === 'rejected') throw new Error('provider rejected');
      if (eventId === 'expired') return presentation(eventId, { expiresAt: NOW });
      return presentation(eventId);
    },
    verifyDeviceProof: ({ proof, verificationEventId }) => proof === `proof-${verificationEventId}`,
  });
}

(async () => {
  const reference = makeReference();
  const created = await reference.execute(command('event-1'));

  assert.strictEqual(created.code, 'UNIFIED_DESKTOP_REGISTERED');
  assert.strictEqual(created.status, 'accepted');
  assert.strictEqual(created.replayed, false);
  assert.deepStrictEqual(Object.keys(created.registration).sort(), ['deviceId', 'installationId', 'linkId']);
  assert.strictEqual(created.registration.installationId, 'installation-1');
  assert.strictEqual(created.session.status, 'active');
  assert.strictEqual(created.session.issuedAt, NOW);
  assert.strictEqual(created.session.expiresAt, '2026-08-21T09:00:00.000Z');
  assert.ok(!JSON.stringify(created).includes('approval'));
  assert.ok(Object.isFrozen(created) && Object.isFrozen(created.registration) && Object.isFrozen(created.session));

  const replay = await reference.execute(command('event-1'));
  assert.strictEqual(replay.replayed, true);
  assert.deepStrictEqual(replay.registration, created.registration);
  assert.deepStrictEqual(replay.session, created.session);

  await assert.rejects(
    reference.execute(command('event-1', {
      installationKeyFingerprint: HASH_B,
      logicalRequestSha256: 'd'.repeat(64),
    })),
    error => error?.code === 'UNIFIED_DESKTOP_IDEMPOTENCY_CONFLICT',
  );

  await assert.rejects(
    reference.execute(command('event-1', {
      idempotencyKey: 'another-attempt',
      logicalRequestSha256: 'f'.repeat(64),
    })),
    error => error?.code === 'UNIFIED_DESKTOP_VERIFICATION_EVENT_CONSUMED',
  );

  await assert.rejects(
    reference.execute(command('expired')),
    error => error?.code === 'UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED',
  );
  await assert.rejects(
    reference.execute(command('rejected')),
    error => error?.code === 'UNIFIED_DESKTOP_ACCOUNT_VERIFICATION_REJECTED',
  );
  await assert.rejects(
    reference.execute(command('event-2', { deviceProof: 'forged-proof' })),
    error => error?.code === 'UNIFIED_DESKTOP_DEVICE_PROOF_REJECTED',
  );
  await assert.rejects(
    reference.execute({ ...command('event-3'), accountId: 'caller-selected-account' }),
    error => error?.code === 'UNIFIED_DESKTOP_REGISTRATION_INPUT_INVALID',
  );

  const renewed = await reference.execute(command('event-4', {
    accountPresentation: 'presentation-event-4',
    verificationNonce: 'nonce-event-4',
    deviceChallenge: 'challenge-event-4',
    deviceProof: 'proof-event-4',
    idempotencyKey: 'attempt-event-4',
  }));
  assert.deepStrictEqual(renewed.registration, created.registration);
  assert.notStrictEqual(renewed.session.sessionId, created.session.sessionId);

  console.log('vNext unified desktop registration reference checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
