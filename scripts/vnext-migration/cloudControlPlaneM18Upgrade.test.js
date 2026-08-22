'use strict';

const assert = require('assert');
const { buildCloudControlPlaneM18UpgradeSql } = require('./cloudControlPlaneM18Upgrade');

const result = buildCloudControlPlaneM18UpgradeSql();

assert.strictEqual(result.migrationCount, 1);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_M17_PREFIX_INVALID/);
assert.match(result.sql, /vnext-pg17-canonical-phone-account-provisioning-17/);
assert.match(result.sql, /vnext-pg17-desktop-password-credentials-18/);
assert.match(result.sql, /vnext_desktop_password_credentials/);
assert.match(result.sql, /vnext_set_desktop_password_credential/);
assert.match(result.sql, /vnext_read_desktop_password_by_phone_hash/);
assert.match(result.sql, /vnext_read_desktop_password_by_login_name/);
assert.strictEqual((result.sql.match(/INSERT INTO vnext_control_plane\.vnext_schema_migrations/g) || []).length, 1);
assert.match(result.sql, /SET LOCAL ROLE vnext_pg17_owner/);
assert.match(result.sql, /REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_owner/);
assert.match(result.sql, /REVOKE vnext_pg17_owner FROM gewu_app/);
assert.ok(result.sql.indexOf('VNEXT_CLOUD_CONTROL_PLANE_M17_PREFIX_INVALID') < result.sql.indexOf('SET LOCAL ROLE vnext_pg17_owner;'));

console.log('cloud control-plane M18 upgrade tests passed');
