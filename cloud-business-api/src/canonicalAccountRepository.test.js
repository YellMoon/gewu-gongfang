'use strict';

const assert = require('assert');

let loaded = null;
try {
  loaded = require('./canonicalAccountRepository');
} catch (_) {
  // RED: the canonical repository does not exist yet.
}

assert.ok(loaded, 'canonical account repository module must exist');
const { createCanonicalAccountRepository } = loaded;

const calls = [];
let rowAccessorRead = false;
const query = async (text, values) => {
  calls.push([text, values]);
  const phoneHash = values[1];
  if (phoneHash === 'a'.repeat(64)) return { rows: [{ authorityId: 'authority-1', accountId: 'account-1' }] };
  if (phoneHash === 'b'.repeat(64)) return { rows: [] };
  if (phoneHash === 'c'.repeat(64)) return { rows: [
    { authorityId: 'authority-1', accountId: 'account-1' },
    { authorityId: 'authority-1', accountId: 'account-2' },
  ] };
  if (phoneHash === 'e'.repeat(64)) {
    return { rows: [new Proxy({ authorityId: 'authority-1', accountId: 'account-1' }, {})] };
  }
  if (phoneHash === 'f'.repeat(64)) {
    const row = { authorityId: 'authority-1' };
    Object.defineProperty(row, 'accountId', {
      enumerable: true,
      get() {
        rowAccessorRead = true;
        return 'account-1';
      },
    });
    return { rows: [row] };
  }
  return { rows: [{ authorityId: 'authority-1', accountId: '' }] };
};

(async () => {
  let configAccessorRead = false;
  const accessorConfig = { authorityId: 'authority-1' };
  Object.defineProperty(accessorConfig, 'query', {
    enumerable: true,
    get() {
      configAccessorRead = true;
      return query;
    },
  });
  assert.throws(
    () => createCanonicalAccountRepository(accessorConfig),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.strictEqual(configAccessorRead, false, 'repository config accessors must not execute');
  assert.throws(
    () => createCanonicalAccountRepository(new Proxy({ query, authorityId: 'authority-1' }, {})),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.throws(
    () => createCanonicalAccountRepository({ query: new Proxy(query, {}), authorityId: 'authority-1' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );

  const repository = createCanonicalAccountRepository({ query, authorityId: 'authority-1' });
  assert.deepStrictEqual(
    await repository.resolveVerifiedPhoneHash({ phoneHash: 'a'.repeat(64) }),
    { authorityId: 'authority-1', accountId: 'account-1' },
  );
  assert.strictEqual(await repository.resolveVerifiedPhoneHash({ phoneHash: 'b'.repeat(64) }), null);
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash({ phoneHash: 'c'.repeat(64) }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_CONFLICT',
  );
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash({ phoneHash: 'd'.repeat(64) }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash({ phoneHash: 'not-a-hash' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash({ phoneHash: 'a'.repeat(64), accountId: 'second-account' }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  let requestAccessorRead = false;
  const accessorRequest = {};
  Object.defineProperty(accessorRequest, 'phoneHash', {
    enumerable: true,
    get() {
      requestAccessorRead = true;
      return 'a'.repeat(64);
    },
  });
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash(accessorRequest),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.strictEqual(requestAccessorRead, false, 'request accessors must not execute');
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash(new Proxy({ phoneHash: 'a'.repeat(64) }, {})),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash({ phoneHash: 'e'.repeat(64) }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  await assert.rejects(
    () => repository.resolveVerifiedPhoneHash({ phoneHash: 'f'.repeat(64) }),
    error => error.code === 'CLOUD_CANONICAL_ACCOUNT_INVALID',
  );
  assert.strictEqual(rowAccessorRead, false, 'database row accessors must not execute');

  assert.match(calls[0][0], /FROM vnext_control_plane\.vnext_verified_contacts/u);
  assert.match(calls[0][0], /JOIN vnext_control_plane\.vnext_accounts/u);
  assert.match(calls[0][0], /verification_state='verified'/u);
  assert.match(calls[0][0], /a\.status='active'/u);
  assert.match(calls[0][0], /LIMIT 2/u);
  assert.doesNotMatch(calls[0][0], /INSERT|UPDATE|DELETE/u, 'canonical account resolution must never create a second account');
  assert.deepStrictEqual(calls[0][1], ['authority-1', 'a'.repeat(64)]);

  console.log('canonical account repository checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
