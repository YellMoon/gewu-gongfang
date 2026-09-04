'use strict';

const assert = require('assert');
const { createDesktopVerifiedAccessService } = require('./desktopVerifiedAccessService');

const phoneHmac = 'a'.repeat(64);
const contexts = new Map([
  ['account-teacher', { accountId: 'account-teacher', status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 'teacher-1' } }],
  ['account-super', { accountId: 'account-super', status: 'active', roles: ['super_admin'], profile: null }],
  ['account-student', { accountId: 'account-student', status: 'active', roles: ['student'], profile: { type: 'student', id: 'student-1' } }],
  ['account-visitor', { accountId: 'account-visitor', status: 'active', roles: [], profile: null }],
]);
const service = createDesktopVerifiedAccessService({
  inspectVerificationToken: token => {
    if (token === 'invalid') throw new Error('invalid ticket');
    return { v: 1, authorityId: 'authority-1', accountId: token, phoneHmac, challenge: 'challenge-1', proofId: 'proof-1', expiresAt: Date.now() + 60_000 };
  },
  readAccountContext: ({ accountId }) => contexts.get(accountId) || null,
  readAccountContextByPhoneHmac: ({ phoneHmac: supplied }) => supplied === phoneHmac ? null : null,
});

(async () => {
  assert.deepStrictEqual(await service.read({ verificationToken: 'account-teacher' }), {
    access: 'allowed', roles: ['teacher'], teacherId: 'teacher-1',
  });
  assert.deepStrictEqual(await service.read({ verificationToken: 'account-super' }), {
    access: 'allowed', roles: ['super_admin'], teacherId: null,
  });
  assert.deepStrictEqual(await service.read({ verificationToken: 'account-visitor' }), {
    access: 'teacher_registration_required', roles: [], teacherId: null,
  });
  assert.deepStrictEqual(await service.read({ verificationToken: 'account-student' }), {
    access: 'teacher_registration_required', roles: [], teacherId: null,
  }, 'a student account must not be admitted to the teacher desktop as a visitor');
  await assert.rejects(
    () => service.read({ verificationToken: 'invalid' }),
    error => error.code === 'CLOUD_DESKTOP_VERIFIED_ACCESS_REJECTED',
  );
  const malformedTicketService = createDesktopVerifiedAccessService({
    inspectVerificationToken: () => ({ v: 2, authorityId: 'authority-1', accountId: 'account-teacher', phoneHmac, challenge: 'challenge-1', proofId: 'proof-1', expiresAt: Date.now() + 60_000 }),
    readAccountContext: ({ accountId }) => contexts.get(accountId) || null,
    readAccountContextByPhoneHmac: () => null,
  });
  await assert.rejects(
    () => malformedTicketService.read({ verificationToken: 'ticket-v2' }),
    error => error.code === 'CLOUD_DESKTOP_VERIFIED_ACCESS_REJECTED',
    'desktop verified access must accept only the v1 ticket contract emitted by desktop registration',
  );
  console.log('desktop verified access service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
