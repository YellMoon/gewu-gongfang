'use strict';

const assert = require('assert');

let loaded = null;
try {
  loaded = require('./canonicalAccountService');
} catch (_) {
  // RED: the shared surface service does not exist yet.
}

assert.ok(loaded, 'canonical account service module must exist');
const { createCanonicalAccountService } = loaded;

(async () => {
  let configAccessorRead = false;
  const accessorConfig = { accountRepository: { resolveVerifiedPhoneHash: async () => null } };
  Object.defineProperty(accessorConfig, 'phoneHash', {
    enumerable: true,
    get() {
      configAccessorRead = true;
      return () => 'a'.repeat(64);
    },
  });
  assert.throws(
    () => createCanonicalAccountService(accessorConfig),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.strictEqual(configAccessorRead, false, 'service config accessors must not execute');
  assert.throws(
    () => createCanonicalAccountService(new Proxy({
      phoneHash: () => 'a'.repeat(64),
      accountRepository: { resolveVerifiedPhoneHash: async () => null },
    }, {})),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.throws(
    () => createCanonicalAccountService({
      phoneHash: new Proxy(() => 'a'.repeat(64), {}),
      accountRepository: { resolveVerifiedPhoneHash: async () => null },
    }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.throws(
    () => createCanonicalAccountService({
      phoneHash: () => 'a'.repeat(64),
      accountRepository: { resolveVerifiedPhoneHash: new Proxy(async () => null, {}) },
    }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );

  const hashes = [];
  const resolutions = [];
  const repository = Object.freeze({
    async resolveVerifiedPhoneHash({ phoneHash }) {
      resolutions.push(phoneHash);
      if (phoneHash === 'b'.repeat(64)) return null;
      if (phoneHash === 'c'.repeat(64)) return { authorityId: 'authority-1', accountId: '' };
      if (phoneHash === 'd'.repeat(64)) {
        return new Proxy({ authorityId: 'authority-1', accountId: 'canonical-account-1' }, {});
      }
      return { authorityId: 'authority-1', accountId: 'canonical-account-1' };
    },
  });
  const service = createCanonicalAccountService({
    phoneHash: phone => {
      hashes.push(phone);
      if (phone === '13800000000') return 'b'.repeat(64);
      if (phone === '13900000000') return 'c'.repeat(64);
      if (phone === '13600000000') return 'd'.repeat(64);
      return 'a'.repeat(64);
    },
    accountRepository: repository,
  });

  const desktop = await service.resolveVerifiedPhone({ verifiedPhone: '13700000000', surface: 'desktop' });
  const miniapp = await service.resolveVerifiedPhone({ verifiedPhone: '13700000000', surface: 'miniapp' });
  assert.deepStrictEqual(desktop, { authorityId: 'authority-1', accountId: 'canonical-account-1' });
  assert.deepStrictEqual(miniapp, desktop, 'desktop and miniapp must resolve the same phone to the same canonical account');
  assert.deepStrictEqual(hashes, ['13700000000', '13700000000']);
  assert.deepStrictEqual(resolutions, ['a'.repeat(64), 'a'.repeat(64)]);
  assert.strictEqual(Object.isFrozen(desktop), true);

  await assert.rejects(
    () => service.resolveVerifiedPhone({ verifiedPhone: '13800000000', surface: 'miniapp' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_NOT_PROVISIONED',
    'an unknown phone must not cause this service to mint a second account id',
  );
  await assert.rejects(
    () => service.resolveVerifiedPhone({ verifiedPhone: '13900000000', surface: 'desktop' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => service.resolveVerifiedPhone({ verifiedPhone: '13700000000', surface: 'legacy-host' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => service.resolveVerifiedPhone({ verifiedPhone: '13700000000', surface: 'desktop', accountId: 'second-account' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => service.resolveVerifiedPhone({ verifiedPhone: ' 13700000000', surface: 'desktop' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  let requestAccessorRead = false;
  const accessorRequest = { surface: 'desktop' };
  Object.defineProperty(accessorRequest, 'verifiedPhone', {
    enumerable: true,
    get() {
      requestAccessorRead = true;
      return '13700000000';
    },
  });
  await assert.rejects(
    () => service.resolveVerifiedPhone(accessorRequest),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.strictEqual(requestAccessorRead, false, 'service request accessors must not execute');
  await assert.rejects(
    () => service.resolveVerifiedPhone(new Proxy({ verifiedPhone: '13700000000', surface: 'desktop' }, {})),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => service.resolveVerifiedPhone({ verifiedPhone: '13600000000', surface: 'desktop' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );

  assert.deepStrictEqual(Object.keys(service), ['resolveVerifiedPhone'], 'the resolver contract must not expose account creation');
  console.log('canonical account service checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
