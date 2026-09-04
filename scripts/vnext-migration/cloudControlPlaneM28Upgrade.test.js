'use strict';

const assert = require('assert');
const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');
const { buildCloudControlPlaneM28UpgradeSql } = require('./cloudControlPlaneM28Upgrade');

const result = buildCloudControlPlaneM28UpgradeSql();
assert.strictEqual(result.migrationId, 'vnext-pg17-desktop-password-conflict-target-fix-28');
assert.strictEqual(result.semanticVersion, 28);
assert.strictEqual(result.migrationCount, 1);
assert.match(result.manifestSha256, /^[0-9a-f]{64}$/u);
assert.match(result.sql, /count\(\*\).*<> 27/u);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_M27_PREFIX_INVALID/u);
for (const migration of MIGRATIONS.slice(0, 27)) {
  assert.ok(result.sql.includes(`('${migration.migrationId.replace(/'/gu, "''")}',${migration.semanticVersion},'${migration.manifestSha256}')`));
}
assert.match(result.sql, /CREATE OR REPLACE FUNCTION vnext_control_plane\.vnext_set_desktop_password_credential/u);
assert.match(result.sql, /ON CONFLICT ON CONSTRAINT vnext_desktop_password_credentials_pkey DO UPDATE/u);
assert.match(result.sql, /gewu-cloud-control-m28-upgrade/u);

console.log('cloud control-plane M28 upgrade tests passed');
