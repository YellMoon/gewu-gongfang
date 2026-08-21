'use strict';

const assert = require('assert');
const { buildCloudControlPlaneBootstrapSql } = require('./cloudControlPlaneBootstrap');

const result = buildCloudControlPlaneBootstrapSql();
assert.strictEqual(result.migrationCount, 15);
assert.match(result.sql, /CREATE SCHEMA vnext_control_plane AUTHORIZATION vnext_pg17_owner/);
assert.match(result.sql, /vnext-pg17-sessions-reauthentication-15/);
assert.doesNotMatch(result.sql, /vnext-pg17-unified-desktop-online-registration-16/);
assert.match(result.sql, /REVOKE CREATE ON DATABASE gewu_cloud FROM vnext_pg17_owner/);
assert.strictEqual((result.sql.match(/INSERT INTO vnext_control_plane\.vnext_schema_migrations/g) || []).length, 15);

console.log('cloud control-plane bootstrap tests passed');
