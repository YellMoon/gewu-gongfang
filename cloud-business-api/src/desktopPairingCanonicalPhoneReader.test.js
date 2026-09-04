'use strict';

const assert = require('assert');
const { createDesktopPairingCanonicalPhoneReader } = require('./desktopPairingCanonicalPhoneReader');

const phoneHmac = 'a'.repeat(64);
const identity = { authorityId: 'authority-1', accountId: 'account-1', phoneHmac };
const calls = [];
let rows = [identity];
const read = createDesktopPairingCanonicalPhoneReader({
  query: async (text, values) => {
    calls.push([text, values]);
    return { rows };
  },
});

(async () => {
  assert.deepStrictEqual(await read({ phoneHmac }), identity);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0][1], [phoneHmac]);
  assert.match(calls[0][0], /vnext_authorities/u);
  assert.match(calls[0][0], /vnext_accounts/u);
  assert.match(calls[0][0], /vnext_verified_contacts/u);
  assert.match(calls[0][0], /contact_type='phone'/u);
  assert.match(calls[0][0], /verification_state='verified'/u);
  assert.match(calls[0][0], /verified_at IS NOT NULL/u);
  assert.match(calls[0][0], /revoked_at IS NULL/u);
  assert.match(calls[0][0], /au\.status='active'/u);
  assert.match(calls[0][0], /a\.status='active'/u);
  assert.match(calls[0][0], /LIMIT 2/u);

  rows = [];
  assert.strictEqual(await read({ phoneHmac }), null);
  rows = [identity, { ...identity, accountId: 'account-2' }];
  assert.strictEqual(await read({ phoneHmac }), null, 'an ambiguous phone mapping must fail closed');
  rows = [{ ...identity, phoneHmac: 'b'.repeat(64) }];
  assert.strictEqual(await read({ phoneHmac }), null, 'the returned phone hash must match the requested binding');
  await assert.rejects(() => read({ phoneHmac: 'bad' }), error => error?.code === 'CLOUD_DESKTOP_PAIRING_REJECTED');
  console.log('desktop pairing canonical phone reader checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
