'use strict';

const assert = require('assert');
const { createDesktopPasswordAuthenticationService } = require('./desktopPasswordAuthenticationService');

const calls = [];
const service = createDesktopPasswordAuthenticationService({
  phoneVerifier: async code => code === 'wechat-phone-proof' ? '13800138000' : (() => { throw new Error('rejected'); })(),
  resolveCanonicalAccount: async input => {
    calls.push(['resolveCanonicalAccount', input]);
    return { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64), provisioned: true };
  },
  verificationEvidenceHash: code => `evidence:${code}`,
  inspectVerificationToken: token => {
    if (token !== 'already-verified-ticket') throw new Error('expired');
    return { v: 1, authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64), challenge: 'already-verified-challenge', proofId: 'proof-1', expiresAt: Date.now() + 60000 };
  },
  passwordIdentity: {
    enroll: async input => {
      calls.push(['enroll', input]);
      return { authorityId: 'authority-1', accountId: 'account-1' };
    },
    verify: async input => {
      calls.push(['verify', input]);
      if (input.password !== 'correct password') throw Object.assign(new Error('rejected'), { code: 'CLOUD_DESKTOP_PASSWORD_REJECTED' });
      return { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) };
    },
    enrollVerifiedAccount: async input => {
      calls.push(['enrollVerifiedAccount', input]);
      return { authorityId: 'authority-1', accountId: 'account-1' };
    },
  },
  issueRegistrationTicket: input => {
    calls.push(['issueRegistrationTicket', input]);
    return { verificationToken: 'signed-registration-ticket', deviceChallenge: 'cloud-device-proof-1' };
  },
});

(async () => {
  const enrolled = await service.enroll({ phoneCode: 'wechat-phone-proof', loginName: 'teacher.a', password: 'correct password' });
  assert.deepStrictEqual(enrolled, { verificationToken: 'signed-registration-ticket', deviceChallenge: 'cloud-device-proof-1' });
  assert.deepStrictEqual(calls.slice(0, 3), [
    ['resolveCanonicalAccount', { verifiedPhone: '13800138000', verificationEvidenceHash: 'evidence:wechat-phone-proof' }],
    ['enroll', { verifiedPhone: '13800138000', authorityId: 'authority-1', accountId: 'account-1', loginName: 'teacher.a', password: 'correct password' }],
    ['issueRegistrationTicket', { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) }],
  ]);

  const verified = await service.verify({ loginType: 'account_name', login: 'teacher.a', password: 'correct password' });
  assert.deepStrictEqual(verified, { verificationToken: 'signed-registration-ticket', deviceChallenge: 'cloud-device-proof-1' });
  assert.deepStrictEqual(calls.slice(3), [
    ['verify', { loginType: 'account_name', login: 'teacher.a', password: 'correct password' }],
    ['issueRegistrationTicket', { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: 'a'.repeat(64) }],
  ]);

  const beforeVerifiedTicketEnrollment = calls.length;
  const ticketEnrolled = await service.enrollFromVerificationTicket({
    verificationToken: 'already-verified-ticket', loginName: 'teacher.ticket', password: 'ticket scoped correct password',
  });
  assert.deepStrictEqual(ticketEnrolled, { verificationToken: 'already-verified-ticket', deviceChallenge: 'already-verified-challenge' });
  assert.deepStrictEqual(calls.slice(beforeVerifiedTicketEnrollment), [
    ['enrollVerifiedAccount', { authorityId: 'authority-1', accountId: 'account-1', phoneHash: 'a'.repeat(64), loginName: 'teacher.ticket', password: 'ticket scoped correct password' }],
  ], 'a valid ticket must be consumed without another phone verification or issuing a broader ticket');

  await assert.rejects(
    () => service.verify({ loginType: 'account_name', login: 'teacher.a', password: 'wrong password' }),
    error => error && error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED',
  );
  await assert.rejects(
    () => service.enroll({ phoneCode: 'invalid', loginName: 'teacher.a', password: 'correct password' }),
    error => error && error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED',
  );
  const beforeExpiredTicket = calls.length;
  await assert.rejects(
    () => service.enrollFromVerificationTicket({ verificationToken: 'expired-ticket', loginName: 'teacher.ticket', password: 'ticket scoped correct password' }),
    error => error && error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED',
  );
  assert.strictEqual(calls.length, beforeExpiredTicket, 'an expired ticket must not enroll credentials or issue a new registration ticket');
  assert.strictEqual(JSON.stringify(enrolled).includes('account-1'), false, 'public enrollment output must not expose canonical account identifiers');
  console.log('desktop password authentication service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
