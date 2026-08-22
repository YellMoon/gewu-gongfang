'use strict';

const assert = require('assert');

let loaded = null;
try {
  loaded = require('./bootstrapAdminIdentity');
} catch (_) {
  // RED: the bootstrap administrator selector has not been isolated yet.
}

assert.ok(loaded, 'bootstrap administrator identity module must exist');
const { resolveBootstrapAdminAccountId } = loaded;

const records = Object.freeze([
  Object.freeze({ phoneHmac: 'a'.repeat(64), authorityId: 'authority-1', accountId: 'account-a' }),
  Object.freeze({ phoneHmac: 'b'.repeat(64), authorityId: 'authority-1', accountId: 'account-b' }),
]);

assert.strictEqual(resolveBootstrapAdminAccountId({ records, accountId: 'account-b' }), 'account-b');
assert.strictEqual(resolveBootstrapAdminAccountId({ records: records.slice().reverse(), accountId: 'account-b' }), 'account-b');
assert.strictEqual(resolveBootstrapAdminAccountId({ records, accountId: 'account-missing' }), null);
assert.strictEqual(resolveBootstrapAdminAccountId({
  records: [...records, Object.freeze({ phoneHmac: 'c'.repeat(64), authorityId: 'authority-1', accountId: 'account-b' })],
  accountId: 'account-b',
}), null, 'a duplicated configured account must fail closed');

let accessorRead = false;
const accessorInput = { records };
Object.defineProperty(accessorInput, 'accountId', {
  enumerable: true,
  get() {
    accessorRead = true;
    return 'account-b';
  },
});
assert.throws(
  () => resolveBootstrapAdminAccountId(accessorInput),
  error => error && error.code === 'CLOUD_BOOTSTRAP_ADMIN_INVALID',
);
assert.strictEqual(accessorRead, false, 'configuration accessors must not execute');
assert.throws(
  () => resolveBootstrapAdminAccountId(new Proxy({ records, accountId: 'account-b' }, {})),
  error => error && error.code === 'CLOUD_BOOTSTRAP_ADMIN_INVALID',
);

console.log('bootstrap administrator identity checks passed');
