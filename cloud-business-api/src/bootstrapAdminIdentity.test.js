'use strict';

const assert = require('assert');

let loaded = null;
try {
  loaded = require('./bootstrapAdminIdentity');
} catch (_) {
  // RED: the bootstrap administrator selector has not been isolated yet.
}

assert.ok(loaded, 'bootstrap administrator identity module must exist');
const { BOOTSTRAP_SUPER_ADMIN_PHONE, resolveBootstrapAdminAccountId } = loaded;
assert.strictEqual(BOOTSTRAP_SUPER_ADMIN_PHONE, '13732250653');

const records = Object.freeze([
  Object.freeze({ phoneHmac: 'a'.repeat(64), authorityId: 'authority-1', accountId: 'account-a' }),
  Object.freeze({ phoneHmac: 'b'.repeat(64), authorityId: 'authority-1', accountId: 'account-b' }),
]);

assert.strictEqual(resolveBootstrapAdminAccountId({ records, phoneHmac: 'b'.repeat(64) }), 'account-b');
assert.strictEqual(resolveBootstrapAdminAccountId({ records: records.slice().reverse(), phoneHmac: 'b'.repeat(64) }), 'account-b');
assert.strictEqual(resolveBootstrapAdminAccountId({ records, phoneHmac: 'c'.repeat(64) }), null);
assert.strictEqual(resolveBootstrapAdminAccountId({
  records: [...records, Object.freeze({ phoneHmac: 'b'.repeat(64), authorityId: 'authority-2', accountId: 'account-c' })],
  phoneHmac: 'b'.repeat(64),
}), null, 'a duplicated configured phone must fail closed');

let accessorRead = false;
const accessorInput = { records };
Object.defineProperty(accessorInput, 'phoneHmac', {
  enumerable: true,
  get() {
    accessorRead = true;
    return 'b'.repeat(64);
  },
});
assert.throws(
  () => resolveBootstrapAdminAccountId(accessorInput),
  error => error && error.code === 'CLOUD_BOOTSTRAP_ADMIN_INVALID',
);
assert.strictEqual(accessorRead, false, 'configuration accessors must not execute');
assert.throws(
  () => resolveBootstrapAdminAccountId(new Proxy({ records, phoneHmac: 'b'.repeat(64) }, {})),
  error => error && error.code === 'CLOUD_BOOTSTRAP_ADMIN_INVALID',
);

console.log('bootstrap administrator identity checks passed');
