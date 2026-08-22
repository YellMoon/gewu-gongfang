'use strict';

const assert = require('assert');
const { buildCloudControlPlaneM19UpgradeSql } = require('./cloudControlPlaneM19Upgrade');

const result = buildCloudControlPlaneM19UpgradeSql();

assert.strictEqual(result.migrationCount, 1);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_M18_PREFIX_INVALID/);
assert.match(result.sql, /vnext-pg17-desktop-password-credentials-18/);
assert.match(result.sql, /vnext-pg17-canonical-wechat-contact-binding-19/);
assert.match(result.sql, /vnext_bind_canonical_wechat_identity/);
assert.match(result.sql, /vnext_read_canonical_account_by_verified_contact/);
assert.strictEqual((result.sql.match(/INSERT INTO vnext_control_plane\.vnext_schema_migrations/g) || []).length, 1);
assert.match(result.sql, /SET LOCAL ROLE vnext_pg17_owner/);
assert.match(result.sql, /REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_owner/);
assert.match(result.sql, /REVOKE vnext_pg17_owner FROM gewu_app/);

console.log('cloud control-plane M19 upgrade tests passed');
