'use strict';

const assert = require('assert');
const { createDesktopPairingService } = require('./desktopPairingService');

let now = new Date('2026-08-21T12:00:00.000Z');
let serial = 0;
const verificationInputs = [];
const issuedIdentities = [];
const schemeInputs = [];
const service = createDesktopPairingService({
  now: () => now,
  randomId: prefix => `${prefix}-${++serial}`,
  resolveWechatIdentity: async input => {
    verificationInputs.push(input);
    return { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) };
  },
  issueVerificationForVerifiedAccount: input => {
    issuedIdentities.push(input);
    return { verificationToken: 'verification-token-1', deviceChallenge: 'desktop-proof-challenge-1' };
  },
  inspectVerificationToken: token => token === 'verification-token-1'
    ? { challenge: 'desktop-proof-challenge-1' }
    : null,
  generateLoginScheme: async input => {
    schemeInputs.push(input);
    return 'weixin://dl/business/?t=pairing-1';
  },
});

(async () => {
  const started = await service.start({
    installationId: 'installation-1',
    installationPublicKey: 'public-key-1',
    idempotencyKey: 'register-1',
  });
  assert.deepStrictEqual(Object.keys(started).sort(), ['expiresAt', 'pairingId', 'pairingSecret', 'qrValue']);
  assert.strictEqual(started.qrValue, 'weixin://dl/business/?t=pairing-1');
  assert.deepStrictEqual(schemeInputs, [{ pairingId: started.pairingId, pairingSecret: started.pairingSecret, expiresAt: started.expiresAt }]);
  assert.strictEqual(service.read({ pairingId: started.pairingId, pairingSecret: started.pairingSecret }).status, 'awaiting_online_verification');

  const verified = await service.confirm({
    pairingId: started.pairingId,
    pairingSecret: started.pairingSecret,
    loginCode: 'wechat-login-code',
    phoneCode: 'wechat-phone-code',
  });
  assert.strictEqual(verified.status, 'verified');
  assert.deepStrictEqual(verificationInputs, [{ loginCode: 'wechat-login-code', phoneCode: 'wechat-phone-code' }]);
  assert.deepStrictEqual(issuedIdentities, [{ authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) }]);
  assert.deepStrictEqual(service.read({ pairingId: started.pairingId, pairingSecret: started.pairingSecret }), {
    status: 'verified',
    verificationToken: 'verification-token-1',
    deviceChallenge: 'desktop-proof-challenge-1',
  });

  await service.confirm({ pairingId: started.pairingId, pairingSecret: started.pairingSecret, loginCode: 'unused-login-code', phoneCode: 'unused-replay-code' });
  assert.strictEqual(verificationInputs.length, 1, 'a verified attempt must not consume another phone proof');
  assert.throws(
    () => service.read({ pairingId: started.pairingId, pairingSecret: 'wrong-secret' }),
    error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED',
  );

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
