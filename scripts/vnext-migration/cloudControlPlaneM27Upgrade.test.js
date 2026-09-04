'use strict';

const assert = require('assert');
const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');
const { buildCloudControlPlaneM27UpgradeSql } = require('./cloudControlPlaneM27Upgrade');

const result = buildCloudControlPlaneM27UpgradeSql();
assert.strictEqual(result.migrationId, 'vnext-pg17-family-member-canonical-role-27');
assert.strictEqual(result.semanticVersion, 27);
assert.strictEqual(result.migrationCount, 1);
assert.match(result.manifestSha256, /^[0-9a-f]{64}$/u);
assert.match(result.sql, /count\(\*\).*<> 26/u);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_M26_PREFIX_INVALID/u);
for (const migration of MIGRATIONS.slice(0, 26)) {
  assert.ok(result.sql.includes(`('${migration.migrationId.replace(/'/gu, "''")}',${migration.semanticVersion},'${migration.manifestSha256}')`));
}
assert.match(result.sql, /DROP CONSTRAINT vnext_role_grants_role_check/u);
assert.match(result.sql, /role IN \('super_admin','teacher','student','family_member'\)/u);
assert.match(result.sql, /gewu-cloud-control-m27-upgrade/u);

console.log('cloud control-plane M27 upgrade tests passed');
