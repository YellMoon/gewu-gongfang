'use strict';

const assert = require('assert');
const { buildCloudControlPlaneM16UpgradeSql } = require('./cloudControlPlaneM16Upgrade');

const result = buildCloudControlPlaneM16UpgradeSql();

assert.strictEqual(result.migrationCount, 1);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_PREFIX_INVALID/);
assert.match(result.sql, /vnext-pg17-sessions-reauthentication-15/);
assert.match(result.sql, /CREATE ROLE vnext_pg17_writer LOGIN NOINHERIT/);
assert.match(result.sql, /CREATE ROLE vnext_pg17_identity_verifier LOGIN NOINHERIT/);
assert.match(result.sql, /vnext-pg17-unified-desktop-online-registration-16/);
assert.strictEqual((result.sql.match(/INSERT INTO vnext_control_plane\.vnext_schema_migrations/g) || []).length, 1);
assert.match(result.sql, /REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_owner/);
assert.match(result.sql, /REVOKE vnext_pg17_owner FROM gewu_app/);
assert.ok(result.sql.indexOf('VNEXT_CLOUD_CONTROL_PLANE_PREFIX_INVALID') < result.sql.indexOf('SET LOCAL ROLE vnext_pg17_owner;'));

console.log('cloud control-plane M16 upgrade tests passed');
