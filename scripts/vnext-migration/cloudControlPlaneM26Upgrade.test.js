'use strict';

const assert = require('assert');
const { MIGRATIONS } = require('../../shared/vnext-pg17/migrationManifest');
const { buildCloudControlPlaneM26UpgradeSql } = require('./cloudControlPlaneM26Upgrade');

const result = buildCloudControlPlaneM26UpgradeSql();
assert.strictEqual(result.migrationId, 'vnext-pg17-desktop-device-revoke-authorization-lock-26');
assert.strictEqual(result.semanticVersion, 26);
assert.strictEqual(result.migrationCount, 1);
assert.match(result.manifestSha256, /^[0-9a-f]{64}$/u);
assert.match(result.sql, /count\(\*\).*<> 25/u);
assert.match(result.sql, /VNEXT_CLOUD_CONTROL_PLANE_M25_PREFIX_INVALID/u);
for (const migration of MIGRATIONS.slice(0, 25)) {
  const migrationId = migration.migrationId.replace(/'/gu, "''");
  assert.ok(
    result.sql.includes(`('${migrationId}',${migration.semanticVersion},'${migration.manifestSha256}')`),
    `immutable prefix must include migration ${migration.semanticVersion}`,
  );
}
assert.match(result.sql, /CREATE OR REPLACE FUNCTION vnext_control_plane\.vnext_revoke_desktop_device/u);
assert.match(result.sql, /actor_account vnext_control_plane\.vnext_accounts%ROWTYPE/u);
assert.match(result.sql, /actor_device vnext_control_plane\.vnext_trusted_devices%ROWTYPE/u);
assert.match(result.sql, /actor_installation vnext_control_plane\.vnext_device_installations%ROWTYPE/u);
assert.match(result.sql, /actor_link vnext_control_plane\.vnext_account_device_links%ROWTYPE/u);
assert.match(result.sql, /actor_grant vnext_control_plane\.vnext_role_grants%ROWTYPE/u);
assert.match(result.sql, /s\.session_id=p_actor_session_id FOR UPDATE/u);
assert.match(result.sql, /actor_session\.account_auth_version[\s\S]*actor_account\.auth_version/u);
assert.match(result.sql, /actor_session\.device_credential_version[\s\S]*actor_device\.credential_version/u);
assert.match(result.sql, /actor_session\.installation_credential_version[\s\S]*actor_installation\.credential_version/u);
assert.match(result.sql, /actor_session\.link_auth_version[\s\S]*actor_link\.auth_version/u);
assert.match(result.sql, /g\.role='super_admin' AND g\.status='active' AND g\.starts_at<=now_at/u);
assert.match(result.sql, /\(g\.ends_at IS NULL OR g\.ends_at>now_at\) FOR SHARE/u);
assert.match(result.sql, /REVOKE EXECUTE ON FUNCTION vnext_control_plane\.vnext_revoke_desktop_device\([^)]+\) FROM PUBLIC/u);
assert.match(result.sql, /GRANT EXECUTE ON FUNCTION vnext_control_plane\.vnext_revoke_desktop_device\([^)]+\) TO vnext_pg17_writer/u);
assert.match(result.sql, /gewu-cloud-control-m26-upgrade/u);

console.log('cloud control-plane M26 upgrade tests passed');
