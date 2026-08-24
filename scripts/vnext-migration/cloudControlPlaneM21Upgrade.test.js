'use strict';

const assert = require('assert');
const { buildCloudControlPlaneM21UpgradeSql } = require('./cloudControlPlaneM21Upgrade');

const result = buildCloudControlPlaneM21UpgradeSql();
assert.strictEqual(result.migrationCount, 1);
assert.strictEqual(result.migrationId, 'vnext-pg17-desktop-session-context-reader-21');
assert.strictEqual(result.semanticVersion, 21);
assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_M20_PREFIX_INVALID/);
assert.match(result.sql, /GRANT SELECT ON TABLE[\s\S]*vnext_control_plane\.vnext_sessions[\s\S]*TO vnext_pg17_writer/);
assert.doesNotMatch(result.sql, /GRANT (?:INSERT|UPDATE|DELETE)/);
assert.strictEqual((result.sql.match(/INSERT INTO vnext_control_plane\.vnext_schema_migrations/g) || []).length, 1);
assert.ok(result.sql.indexOf('SET LOCAL ROLE vnext_pg17_owner;') < result.sql.indexOf('GRANT SELECT ON TABLE'));
assert.ok(result.sql.indexOf('GRANT SELECT ON TABLE') < result.sql.indexOf('REVOKE vnext_pg17_owner FROM gewu_app;'));
console.log('cloud control-plane M21 upgrade tests passed');
