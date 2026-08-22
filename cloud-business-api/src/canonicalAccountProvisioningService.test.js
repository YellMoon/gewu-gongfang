'use strict';

const assert = require('assert');
const { createHash } = require('crypto');
const { createCanonicalAccountProvisioningService } = require('./canonicalAccountProvisioningService');

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

async function main() {
  const calls = [];
  const service = createCanonicalAccountProvisioningService({
    phoneHash: phone => hash(`phone:${phone}`),
    randomId: prefix => `${prefix}-generated`,
    legacyAccountForPhoneHash: ({ phoneHash }) => phoneHash === hash('phone:legacy-phone') ? { accountId: 'legacy-account' } : null,
    provisionPhoneAccount: async input => {
      calls.push(input);
      return {
        authorityId: 'authority-1',
        accountId: input.phoneHash === hash('phone:existing-phone') ? 'existing-account' : input.accountId,
      };
    },
  });

  assert.deepStrictEqual(
    await service.resolveOrProvision({ verifiedPhone: 'existing-phone', verificationEvidenceHash: 'b'.repeat(64) }),
    { authorityId: 'authority-1', accountId: 'existing-account', provisioned: true },
  );
  assert.deepStrictEqual(calls[0], {
    accountId: 'account-generated',
    contactId: 'verified-contact-generated',
    phoneHash: hash('phone:existing-phone'),
    verificationEvidenceHash: 'b'.repeat(64),
  });

  assert.deepStrictEqual(
    await service.resolveOrProvision({ verifiedPhone: 'new-phone', verificationEvidenceHash: 'c'.repeat(64) }),
    { authorityId: 'authority-1', accountId: 'account-generated', provisioned: true },
  );
  assert.deepStrictEqual(calls[1], {
    accountId: 'account-generated',
    contactId: 'verified-contact-generated',
    phoneHash: hash('phone:new-phone'),
    verificationEvidenceHash: 'c'.repeat(64),
  });

  assert.deepStrictEqual(
    await service.resolveOrProvision({ verifiedPhone: 'legacy-phone', verificationEvidenceHash: 'd'.repeat(64) }),
    { authorityId: 'authority-1', accountId: 'legacy-account', provisioned: true },
  );
  assert.strictEqual(calls[2].accountId, 'legacy-account');

  await assert.rejects(
    () => service.resolveOrProvision({ verifiedPhone: 'new-phone', verificationEvidenceHash: 'bad' }),
    error => error && error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  console.log('canonical account provisioning service checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
