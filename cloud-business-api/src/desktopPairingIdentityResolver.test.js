'use strict';

const assert = require('assert');
const { createDesktopPairingIdentityResolver } = require('./desktopPairingIdentityResolver');

const phoneHmac = 'a'.repeat(64);
const calls = [];
const resolve = createDesktopPairingIdentityResolver({
  accountRepository: {
    async readVerifiedPhoneBinding(input) {
      calls.push(['binding', input]);
      return input.accountId === 'account-1' ? { accountId: 'account-1', phoneHmac } : null;
    },
  },
  async readCanonicalByPhoneHmac(input) {
    calls.push(['canonical', input]);
    return { authorityId: 'authority-1', accountId: 'account-1', phoneHmac };
  },
});

(async () => {
  assert.deepStrictEqual(await resolve({ accountId: 'account-1' }), {
    authorityId: 'authority-1', accountId: 'account-1', phoneHmac,
  });
  assert.deepStrictEqual(calls, [
    ['binding', { accountId: 'account-1' }],
    ['canonical', { phoneHmac }],
  ]);
  assert.strictEqual(await resolve({ accountId: 'missing-account' }), null);

  const mismatched = createDesktopPairingIdentityResolver({
    accountRepository: { readVerifiedPhoneBinding: async () => ({ accountId: 'account-1', phoneHmac }) },
    readCanonicalByPhoneHmac: async () => ({ authorityId: 'authority-1', accountId: 'account-2', phoneHmac }),
  });
  assert.strictEqual(await mismatched({ accountId: 'account-1' }), null);
  await assert.rejects(() => resolve({ accountId: ' account-1' }), error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED');
  console.log('desktop pairing identity resolver checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
