'use strict';

const assert = require('assert');
const { createDesktopPairingService } = require('./desktopPairingService');

let now = new Date('2026-08-21T12:00:00.000Z');
let serial = 0;
const verificationInputs = [];
const sessionIdentityInputs = [];
const issuedIdentities = [];
const codeInputs = [];
const service = createDesktopPairingService({
  now: () => now,
  randomId: prefix => `${prefix}-${++serial}`,
  resolveWechatIdentity: async input => {
    verificationInputs.push(input);
    return { authorityId: 'authority-1', accountId: 'legacy-account', phoneHmac: 'b'.repeat(64) };
  },
  resolveVerifiedAccount: async input => {
    sessionIdentityInputs.push(input);
    return { authorityId: 'authority-1', accountId: input.accountId, phoneHmac: 'a'.repeat(64) };
  },
  issueVerificationForVerifiedAccount: input => {
    issuedIdentities.push(input);
    return { verificationToken: 'verification-token-1', deviceChallenge: 'desktop-proof-challenge-1' };
  },
  inspectVerificationToken: token => token === 'verification-token-1'
    ? { challenge: 'desktop-proof-challenge-1' }
    : null,
  generateLoginCode: async input => {
    codeInputs.push(input);
    return 'data:image/png;base64,cHJvZHVjdGlvbi1taW5pYXBwLXFy';
  },
});

(async () => {
  const started = await service.start({
    installationId: 'installation-1',
    installationPublicKey: 'public-key-1',
    idempotencyKey: 'register-1',
  });
  assert.deepStrictEqual(Object.keys(started).sort(), ['expiresAt', 'pairingId', 'pairingSecret', 'qrImageDataUrl']);
  assert.strictEqual(started.qrImageDataUrl, 'data:image/png;base64,cHJvZHVjdGlvbi1taW5pYXBwLXFy');
  assert.strictEqual(codeInputs.length, 1);
  assert.match(codeInputs[0].scene, /^d_[A-Za-z0-9_-]{30}$/u);
  assert.ok(!codeInputs[0].scene.includes(started.pairingId));
  assert.ok(!codeInputs[0].scene.includes(started.pairingSecret));
  assert.deepStrictEqual(Object.keys(codeInputs[0]), ['scene']);
  assert.strictEqual(service.read({ pairingId: started.pairingId, pairingSecret: started.pairingSecret }).status, 'awaiting_online_verification');

  const verified = await service.confirm({
    scene: codeInputs[0].scene,
    accountId: 'account-1',
  });
  assert.strictEqual(verified.status, 'verified');
  assert.deepStrictEqual(sessionIdentityInputs, [{ accountId: 'account-1' }]);
  assert.deepStrictEqual(issuedIdentities, [{ authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) }]);
  assert.deepStrictEqual(service.read({ pairingId: started.pairingId, pairingSecret: started.pairingSecret }), {
    status: 'verified',
    verificationToken: 'verification-token-1',
    deviceChallenge: 'desktop-proof-challenge-1',
  });

  await service.confirm({ scene: codeInputs[0].scene, accountId: 'account-1' });
  assert.strictEqual(sessionIdentityInputs.length, 1, 'a verified attempt must not resolve the account again');
  await assert.rejects(
    () => service.confirm({ scene: codeInputs[0].scene, accountId: 'different-account' }),
    error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED',
    'an already verified pairing must stay bound to its authenticated account',
  );
  assert.throws(
    () => service.read({ pairingId: started.pairingId, pairingSecret: 'wrong-secret' }),
    error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED',
  );
  await assert.rejects(
    () => service.confirm({ scene: codeInputs[0].scene, loginCode: 'legacy-login-code', phoneCode: 'legacy-phone-code' }),
    error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED',
    'the session confirmation method must not accept the legacy request shape',
  );

  const legacyPairing = await service.start({ installationId: 'installation-legacy', installationPublicKey: 'public-key-legacy', idempotencyKey: 'register-legacy' });
  const legacyVerified = await service.confirmLegacy({ scene: codeInputs[1].scene, loginCode: 'legacy-login-code', phoneCode: 'legacy-phone-code' });
  assert.strictEqual(legacyVerified.status, 'verified');
  assert.deepStrictEqual(verificationInputs, [{ loginCode: 'legacy-login-code', phoneCode: 'legacy-phone-code' }]);
  assert.strictEqual(service.read({ pairingId: legacyPairing.pairingId, pairingSecret: legacyPairing.pairingSecret }).status, 'verified');

  const expiring = await service.start({ installationId: 'installation-2', installationPublicKey: 'public-key-2', idempotencyKey: 'register-2' });
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
