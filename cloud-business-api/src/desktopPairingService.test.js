'use strict';

const assert = require('assert');
const { createDesktopPairingService } = require('./desktopPairingService');

let now = new Date('2026-08-21T12:00:00.000Z');
let serial = 0;
const verificationInputs = [];
const service = createDesktopPairingService({
  now: () => now,
  randomId: prefix => `${prefix}-${++serial}`,
  beginOnlineVerification: async input => {
    verificationInputs.push(input);
    return { verificationToken: 'verification-token-1' };
  },
  inspectVerificationToken: token => token === 'verification-token-1'
    ? { challenge: 'desktop-proof-challenge-1' }
    : null,
});

(async () => {
  const started = service.start({
    installationId: 'installation-1',
    installationPublicKey: 'public-key-1',
    idempotencyKey: 'register-1',
  });
  assert.deepStrictEqual(Object.keys(started).sort(), ['expiresAt', 'pairingId', 'pairingSecret']);
  assert.strictEqual(service.read({ pairingId: started.pairingId, pairingSecret: started.pairingSecret }).status, 'awaiting_online_verification');

  const verified = await service.confirm({
    pairingId: started.pairingId,
    pairingSecret: started.pairingSecret,
    phoneCode: 'wechat-phone-code',
  });
  assert.strictEqual(verified.status, 'verified');
  assert.deepStrictEqual(verificationInputs, [{ phoneCode: 'wechat-phone-code' }]);
  assert.deepStrictEqual(service.read({ pairingId: started.pairingId, pairingSecret: started.pairingSecret }), {
    status: 'verified',
    verificationToken: 'verification-token-1',
    deviceChallenge: 'desktop-proof-challenge-1',
  });

  await service.confirm({ pairingId: started.pairingId, pairingSecret: started.pairingSecret, phoneCode: 'unused-replay-code' });
  assert.strictEqual(verificationInputs.length, 1, 'a verified attempt must not consume another phone proof');
  assert.throws(
    () => service.read({ pairingId: started.pairingId, pairingSecret: 'wrong-secret' }),
    error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED',
  );

  const expiring = service.start({ installationId: 'installation-2', installationPublicKey: 'public-key-2', idempotencyKey: 'register-2' });
  now = new Date('2026-08-21T12:06:00.000Z');
  assert.throws(
    () => service.read({ pairingId: expiring.pairingId, pairingSecret: expiring.pairingSecret }),
    error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED',
  );
  console.log('cloud desktop pairing service checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
