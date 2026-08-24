'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { buildCloudOperatorIdentitySeedSql } = require('./cloudOperatorIdentitySeed');

const result = buildCloudOperatorIdentitySeedSql({
  authorityId: 'tenant-1',
  operators: [
    { id: 'legacy-admin', role: 'admin' },
    { id: 'legacy-super', role: 'super_admin' },
  ],
});

assert.strictEqual(result.accountCount, 2);
assert.strictEqual(result.superAdminGrantCount, 1);
assert.match(result.sql, /INSERT INTO vnext_control_plane\.vnext_authorities/);
const opaque = (kind, value) => `legacy-${kind}-${crypto.createHash('sha256').update(`v1:${kind}:${value}`, 'utf8').digest('hex').slice(0, 32)}`;
assert.match(result.sql, new RegExp(opaque('account', 'legacy-admin')));
assert.match(result.sql, new RegExp(opaque('account', 'legacy-super')));
assert.doesNotMatch(result.sql, /legacy-admin|legacy-super/);
assert.match(result.sql, /'super_admin'/);
assert.doesNotMatch(result.sql, /'admin'/);
assert.doesNotMatch(result.sql, /phone|wechat|contact/i);

const quoted = buildCloudOperatorIdentitySeedSql({
  authorityId: 'tenant-1',
  operators: [{ id: "legacy-o'hare", role: 'super_admin' }],
});
assert.match(quoted.sql, new RegExp(opaque('account', "legacy-o'hare")));
assert.match(quoted.sql, new RegExp(opaque('role', "legacy-o'hare")));
assert.doesNotMatch(quoted.sql, /o''hare/);

assert.throws(() => buildCloudOperatorIdentitySeedSql({
  authorityId: 'tenant-1', operators: [{ id: 'admin-only', role: 'admin' }],
}), error => error?.code === 'VNEXT_CLOUD_OPERATOR_IDENTITY_INVALID');
assert.throws(() => buildCloudOperatorIdentitySeedSql({
  authorityId: 'tenant-1', operators: [{ id: 'super-1', role: 'super_admin' }, { id: 'super-2', role: 'super_admin' }],
}), error => error?.code === 'VNEXT_CLOUD_OPERATOR_IDENTITY_INVALID');

console.log('cloud operator identity seed tests passed');
