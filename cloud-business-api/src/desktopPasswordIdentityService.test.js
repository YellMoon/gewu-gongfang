'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createDesktopPasswordIdentityService } = require('./desktopPasswordIdentityService');

const credentialsByPhoneHash = new Map();
const credentialsByLoginName = new Map();
const phoneHash = value => crypto.createHash('sha256').update(`phone:${value}`, 'utf8').digest('hex');

(async () => {
  const service = createDesktopPasswordIdentityService({
    phoneHash,
    randomBytes: size => Buffer.alloc(size, 7),
    saveCredential: async credential => {
      if (typeof credential.phoneHash === 'string') credentialsByPhoneHash.set(credential.phoneHash, credential);
      if (credential.loginName !== null) credentialsByLoginName.set(credential.loginName, credential);
    },
    lookupByPhoneHash: async hash => credentialsByPhoneHash.get(hash) || null,
    lookupByLoginName: async name => credentialsByLoginName.get(name) || null,
  });

  const enrolled = await service.enroll({
    verifiedPhone: '13800138000',
    accountId: 'account-1',
    authorityId: 'authority-1',
    loginName: 'teacher.a',
    password: 'correct horse battery staple',
  });
  assert.deepStrictEqual(enrolled, { authorityId: 'authority-1', accountId: 'account-1' });
  assert.strictEqual(credentialsByPhoneHash.size, 1);
  assert.ok(!JSON.stringify([...credentialsByPhoneHash.values()]).includes('correct horse battery staple'));

  const ticketEnrolled = await service.enrollVerifiedAccount({
    accountId: 'account-verified-1',
    authorityId: 'authority-1',
    phoneHash: phoneHash('13700137000'),
    loginName: 'teacher.ticket',
    password: 'ticket scoped correct password',
  });
  assert.deepStrictEqual(ticketEnrolled, { authorityId: 'authority-1', accountId: 'account-verified-1' });
  assert.strictEqual(credentialsByPhoneHash.size, 2, 'a verified registration ticket must retain the verified phone hash without exposing the phone number');
  assert.deepStrictEqual(
    await service.verify({ loginType: 'phone', login: '13700137000', password: 'ticket scoped correct password' }),
    { authorityId: 'authority-1', accountId: 'account-verified-1', phoneHmac: phoneHash('13700137000') },
  );
  assert.deepStrictEqual(
    await service.verify({ loginType: 'account_name', login: 'teacher.ticket', password: 'ticket scoped correct password' }),
    { authorityId: 'authority-1', accountId: 'account-verified-1', phoneHmac: phoneHash('13700137000') },
  );

  assert.deepStrictEqual(
    await service.verify({ loginType: 'account_name', login: 'teacher.a', password: 'correct horse battery staple' }),
    { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: phoneHash('13800138000') },
  );
  assert.deepStrictEqual(
    await service.verify({ loginType: 'phone', login: '13800138000', password: 'correct horse battery staple' }),
    { authorityId: 'authority-1', accountId: 'account-1', phoneHmac: phoneHash('13800138000') },
  );
  await assert.rejects(
    () => service.verify({ loginType: 'phone', login: '13800138000', password: 'wrong password' }),
    error => error && error.code === 'CLOUD_DESKTOP_PASSWORD_REJECTED',
  );
  await assert.rejects(
    () => service.verify({ loginType: 'account_name', login: 'unknown', password: 'correct horse battery staple' }),
    error => error && error.code === 'CLOUD_DESKTOP_PASSWORD_REJECTED',
  );
  await assert.rejects(
    () => service.enroll({ verifiedPhone: '13800138000', accountId: 'account-1', authorityId: 'authority-1', loginName: 'bad name', password: 'correct horse battery staple' }),
    error => error && error.code === 'CLOUD_DESKTOP_PASSWORD_INVALID',
  );
  await service.enroll({
    verifiedPhone: '13900139000',
    accountId: 'account-2',
    authorityId: 'authority-1',
    loginName: null,
    password: 'another correct battery staple',
  });
  assert.deepStrictEqual(
    await service.verify({ loginType: 'phone', login: '13900139000', password: 'another correct battery staple' }),
    { authorityId: 'authority-1', accountId: 'account-2', phoneHmac: phoneHash('13900139000') },
  );
  console.log('desktop password identity service checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
