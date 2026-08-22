'use strict';

const assert = require('assert');
const { buildCloudControlPlaneM17UpgradeSql } = require('./cloudControlPlaneM17Upgrade');

const result = buildCloudControlPlaneM17UpgradeSql();

assert.strictEqual(result.migrationCount, 1);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_M16_PREFIX_INVALID/);
assert.match(result.sql, /vnext-pg17-unified-desktop-online-registration-16/);
assert.match(result.sql, /vnext-pg17-canonical-phone-account-provisioning-17/);
assert.match(result.sql, /vnext_provision_canonical_phone_account/);
assert.strictEqual((result.sql.match(/INSERT INTO vnext_control_plane\.vnext_schema_migrations/g) || []).length, 1);
assert.match(result.sql, /SET LOCAL ROLE vnext_pg17_owner/);
assert.match(result.sql, /REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_owner/);
assert.match(result.sql, /REVOKE vnext_pg17_owner FROM gewu_app/);
assert.ok(result.sql.indexOf('VNEXT_CLOUD_CONTROL_PLANE_M16_PREFIX_INVALID') < result.sql.indexOf('SET LOCAL ROLE vnext_pg17_owner;'));

console.log('cloud control-plane M17 upgrade tests passed');
