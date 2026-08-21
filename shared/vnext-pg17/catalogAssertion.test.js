'use strict';

const assert = require('assert');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const {
  FIRST_MIGRATION,
  FOUNDATION_IDENTITY_DEVICE_MIGRATION,
  ROLE_GRANTS_MIGRATION,
  CAPABILITY_CATALOG_MIGRATION,
  CAPABILITY_OVERRIDES_MIGRATION,
  DATA_SCOPE_GRANTS_MIGRATION,
  PROFILE_BINDINGS_MIGRATION,
  VERIFIED_CONTACTS_MIGRATION,
  AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION,
  AUTHORIZATION_AUDIT_EVENTS_MIGRATION,
  AUTHORIZATION_OUTBOX_EVENTS_MIGRATION,
  BOOTSTRAP_CONSUMPTIONS_MIGRATION,
  AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION,
  TRUST_ROOT_EVIDENCE_MIGRATION,
  SESSIONS_REAUTHENTICATION_MIGRATION,
} = require('./migrationManifest');

const FOUNDATION_INSTANT = '2026-08-15T00:00:00.000Z';
const HARDWARE_EVIDENCE_HASH = 'a'.repeat(64);
const KEY_FINGERPRINT = 'b'.repeat(64);

async function assertFoundationSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const tables = [
      'vnext_authorities',
      'vnext_accounts',
      'vnext_trusted_devices',
      'vnext_device_installations',
      'vnext_account_device_links',
    ];
    for (const table of tables) {
      const count = await facade.query(`SELECT COUNT(*)::text AS count FROM vnext_control_plane.${table}`);
      assert.deepStrictEqual(count.rows, [{ count: '0' }]);
    }
    const meta = await facade.query('SELECT schema_key, schema_version::text AS schema_version FROM vnext_control_plane.vnext_schema_meta');
    assert.deepStrictEqual(meta.rows, [{ schema_key: 'control-plane-reference', schema_version: '5' }]);

    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ($1, $2, $3, $3)',
      ['authority-1', 'active', FOUNDATION_INSTANT],
    );
    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_accounts (account_id, authority_id, status, auth_version, access_version, revocation_version, row_version, created_at, updated_at) VALUES ($1, $2, $3, 1, 1, 1, 1, $4, $4)',
      ['account-1', 'authority-1', 'active', FOUNDATION_INSTANT],
    );
    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_trusted_devices (device_id, authority_id, status, hardware_evidence_hash, risk_code, credential_version, risk_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, 1, 1, 1, $6, $6, NULL)',
      ['device-1', 'authority-1', 'active', HARDWARE_EVIDENCE_HASH, 'normal', FOUNDATION_INSTANT],
    );
    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_device_installations (installation_id, authority_id, device_id, installation_public_key, key_fingerprint, status, credential_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $7, NULL)',
      ['installation-1', 'authority-1', 'device-1', 'public-key-1', KEY_FINGERPRINT, 'active', FOUNDATION_INSTANT],
    );
    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_account_device_links (link_id, authority_id, account_id, device_id, installation_id, status, auth_version, access_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, 1, $7, $7, NULL)',
      ['link-1', 'authority-1', 'account-1', 'device-1', 'installation-1', 'active', FOUNDATION_INSTANT],
    );

    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_accounts (account_id, authority_id, status, auth_version, access_version, revocation_version, row_version, created_at, updated_at) VALUES ($1, $2, $3, 1, 1, 1, 1, $4, $4)',
      ['other-account', 'other-authority', 'active', FOUNDATION_INSTANT],
    ));
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_device_installations (installation_id, authority_id, device_id, installation_public_key, key_fingerprint, status, credential_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $7, NULL)',
      ['installation-duplicate', 'authority-1', 'device-1', 'public-key-2', KEY_FINGERPRINT, 'active', FOUNDATION_INSTANT],
    ));
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_account_device_links (link_id, authority_id, account_id, device_id, installation_id, status, auth_version, access_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, 1, $7, $7, NULL)',
      ['link-wrong-authority', 'other-authority', 'account-1', 'device-1', 'installation-1', 'active', FOUNDATION_INSTANT],
    ));
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_trusted_devices (device_id, authority_id, status, credential_version, risk_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, 1, 1, 1, $4, $4, NULL)',
      ['device-revoked-invalid', 'authority-1', 'revoked', FOUNDATION_INSTANT],
    ));
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_device_installations (installation_id, authority_id, device_id, installation_public_key, key_fingerprint, status, credential_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $7, $7)',
      ['installation-active-invalid', 'authority-1', 'device-1', 'public-key-3', 'c'.repeat(64), 'active', FOUNDATION_INSTANT],
    ), error => error && error.constraint === 'vnext_device_installations_check1');
    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_device_installations (installation_id, authority_id, device_id, installation_public_key, key_fingerprint, status, credential_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $7, NULL)',
      ['installation-2', 'authority-1', 'device-1', 'public-key-4', 'd'.repeat(64), 'active', FOUNDATION_INSTANT],
    );
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_account_device_links (link_id, authority_id, account_id, device_id, installation_id, status, auth_version, access_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, 1, $7, $7, $7)',
      ['link-expired-invalid', 'authority-1', 'account-1', 'device-1', 'installation-2', 'expired', FOUNDATION_INSTANT],
    ), error => error && error.constraint === 'vnext_account_device_links_check1');
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_accounts (account_id, authority_id, status, auth_version, access_version, revocation_version, row_version, created_at, updated_at) VALUES ($1, $2, $3, 0, 1, 1, 1, $4, $4)',
      ['account-zero-version', 'authority-1', 'active', FOUNDATION_INSTANT],
    ));
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ($1, $2, $3, $3)',
      ['   ', 'active', FOUNDATION_INSTANT],
    ));
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_device_installations (installation_id, authority_id, device_id, installation_public_key, key_fingerprint, status, credential_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $7, NULL)',
      ['installation-blank-fingerprint', 'authority-1', 'device-1', 'public-key-5', '   ', 'active', FOUNDATION_INSTANT],
    ), error => error && error.constraint === 'vnext_device_installations_key_fingerprint_check');
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_device_installations (installation_id, authority_id, device_id, installation_public_key, key_fingerprint, status, credential_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $7, NULL)',
      ['installation-uppercase-fingerprint', 'authority-1', 'device-1', 'public-key-6', 'E'.repeat(64), 'active', FOUNDATION_INSTANT],
    ), error => error && error.constraint === 'vnext_device_installations_key_fingerprint_check');
    await assert.rejects(() => facade.query(
      'INSERT INTO vnext_control_plane.vnext_trusted_devices (device_id, authority_id, status, hardware_evidence_hash, credential_version, risk_version, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, 1, 1, 1, $5, $5, NULL)',
      ['device-invalid-hash', 'authority-1', 'active', 'not-a-sha256', FOUNDATION_INSTANT],
    ), error => error && error.constraint === 'vnext_trusted_devices_hardware_evidence_hash_check');
  });
}

async function assertRoleGrantSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const insertGrant = async ({
      grantId,
      authorityId = 'authority-1',
      accountId = 'account-1',
      role = 'teacher',
      status = 'active',
      grantVersion = 1,
      rowVersion = 1,
      startsAt = FOUNDATION_INSTANT,
      endsAt = null,
      revokedAt = null,
      grantedByAccountId = null,
      createdAt = FOUNDATION_INSTANT,
      updatedAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_role_grants (grant_id, authority_id, account_id, role, status, grant_version, row_version, starts_at, ends_at, revoked_at, granted_by_account_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [grantId, authorityId, accountId, role, status, grantVersion, rowVersion, startsAt, endsAt, revokedAt, grantedByAccountId, createdAt, updatedAt],
    );

    await insertGrant({ grantId: 'grant-1', grantedByAccountId: 'account-1' });
    await assert.rejects(() => insertGrant({ grantId: 'grant-duplicate' }), /duplicate key/);
    await insertGrant({ grantId: 'grant-revoked-history', status: 'revoked', revokedAt: FOUNDATION_INSTANT });
    await facade.query("UPDATE vnext_control_plane.vnext_role_grants SET status = 'revoked', revoked_at = $1 WHERE grant_id = 'grant-1'", [FOUNDATION_INSTANT]);
    await insertGrant({ grantId: 'grant-replacement' });

    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ($1, $2, $3, $3)',
      ['authority-2', 'active', FOUNDATION_INSTANT],
    );
    await facade.query(
      'INSERT INTO vnext_control_plane.vnext_accounts (account_id, authority_id, status, auth_version, access_version, revocation_version, row_version, created_at, updated_at) VALUES ($1, $2, $3, 1, 1, 1, 1, $4, $4)',
      ['account-2', 'authority-2', 'active', FOUNDATION_INSTANT],
    );
    await assert.rejects(() => insertGrant({ grantId: 'grant-cross-account', accountId: 'account-2' }), /foreign key/);
    await assert.rejects(() => insertGrant({ grantId: 'grant-cross-grantor', role: 'student', grantedByAccountId: 'account-2' }), /foreign key/);
    await assert.rejects(
      () => insertGrant({ grantId: '   ', role: 'student' }),
      error => error && error.constraint === 'vnext_role_grants_grant_id_check',
    );
    await assert.rejects(
      () => insertGrant({ grantId: 'grant-blank-grantor', role: 'super_admin', grantedByAccountId: '   ' }),
      error => error && error.constraint === 'vnext_role_grants_granted_by_account_id_check',
    );
    await assert.rejects(() => insertGrant({ grantId: 'grant-invalid-role', role: 'admin' }));
    await assert.rejects(() => insertGrant({ grantId: 'grant-invalid-status', status: 'pending' }));
    await assert.rejects(() => insertGrant({ grantId: 'grant-zero-version', role: 'student', grantVersion: 0 }));
    await assert.rejects(() => insertGrant({ grantId: 'grant-fractional-version', role: 'super_admin', rowVersion: 1.5 }));
    await assert.rejects(() => insertGrant({ grantId: 'grant-end-before-start', role: 'student', endsAt: FOUNDATION_INSTANT }));
    await assert.rejects(() => insertGrant({ grantId: 'grant-active-revoked', role: 'super_admin', revokedAt: FOUNDATION_INSTANT }));
    await assert.rejects(() => insertGrant({ grantId: 'grant-revoked-missing-time', status: 'revoked' }));
    await assert.rejects(() => insertGrant({ grantId: 'grant-expired-missing-end', status: 'expired' }));
    await assert.rejects(
      () => insertGrant({ grantId: 'grant-infinite-start', role: 'student', startsAt: 'infinity' }),
      error => error && error.constraint === 'vnext_role_grants_starts_at_check',
    );
    await assert.rejects(
      () => insertGrant({ grantId: 'grant-infinite-end', role: 'super_admin', endsAt: 'infinity' }),
      error => error && error.constraint === 'vnext_role_grants_ends_at_check',
    );
    await assert.rejects(
      () => insertGrant({ grantId: 'grant-infinite-revocation', role: 'student', status: 'revoked', revokedAt: '-infinity' }),
      error => error && error.constraint === 'vnext_role_grants_revoked_at_check',
    );
  });
}

async function assertCapabilityCatalogSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const insertCapability = ({
      capabilityId,
      status = 'active',
      surfaceMask = 'desktop',
      createdAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_capability_catalog (capability_id, status, surface_mask, created_at) VALUES ($1, $2, $3, $4)',
      [capabilityId, status, surfaceMask, createdAt],
    );

    await insertCapability({ capabilityId: 'access.manage' });
    await insertCapability({ capabilityId: 'access.retired', status: 'retired' });
    await assert.rejects(() => insertCapability({ capabilityId: 'access.manage' }), /duplicate key/);
    await assert.rejects(
      () => insertCapability({ capabilityId: '   ' }),
      error => error && error.constraint === 'vnext_capability_catalog_capability_id_check',
    );
    await assert.rejects(
      () => insertCapability({ capabilityId: 'access.blank-surface', surfaceMask: '   ' }),
      error => error && error.constraint === 'vnext_capability_catalog_surface_mask_check',
    );
    await assert.rejects(
      () => insertCapability({ capabilityId: 'access.invalid-status', status: 'pending' }),
      error => error && error.constraint === 'vnext_capability_catalog_status_check',
    );
    await assert.rejects(
      () => insertCapability({ capabilityId: 'access.infinite-created', createdAt: 'infinity' }),
      error => error && error.constraint === 'vnext_capability_catalog_created_at_check',
    );
    await assert.rejects(
      () => insertCapability({ capabilityId: 'access.negative-infinite-created', createdAt: '-infinity' }),
      error => error && error.constraint === 'vnext_capability_catalog_created_at_check',
    );
  });
  await assert.rejects(
    () => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
      "INSERT INTO vnext_control_plane.vnext_capability_catalog (capability_id, status, surface_mask, created_at) VALUES ('verifier-write', 'active', 'desktop', $1)",
      [FOUNDATION_INSTANT],
    )),
  );
  await assert.rejects(
    () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
      'SELECT * FROM vnext_control_plane.vnext_capability_catalog',
    )),
  );
}

async function assertCapabilityOverrideSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const insertOverride = ({
      overrideId,
      authorityId = 'authority-1',
      accountId = 'account-1',
      capabilityId = 'access.manage',
      effect = 'allow',
      status = 'active',
      startsAt = FOUNDATION_INSTANT,
      endsAt = null,
      rowVersion = 1,
      createdAt = FOUNDATION_INSTANT,
      updatedAt = FOUNDATION_INSTANT,
      revokedAt = null,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_capability_overrides (override_id, authority_id, account_id, capability_id, effect, status, starts_at, ends_at, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [overrideId, authorityId, accountId, capabilityId, effect, status, startsAt, endsAt, rowVersion, createdAt, updatedAt, revokedAt],
    );

    await insertOverride({ overrideId: 'override-allow' });
    await assert.rejects(() => insertOverride({ overrideId: 'override-duplicate' }), /duplicate key/);
    await insertOverride({ overrideId: 'override-retired-capability', capabilityId: 'access.retired', effect: 'deny' });
    await insertOverride({ overrideId: 'override-revoked-history', status: 'revoked', revokedAt: FOUNDATION_INSTANT });
    await insertOverride({ overrideId: 'override-expired-history', status: 'expired', endsAt: '2026-08-15T00:01:00.000Z' });
    await facade.query("UPDATE vnext_control_plane.vnext_capability_overrides SET status = 'revoked', revoked_at = $1 WHERE override_id = 'override-allow'", [FOUNDATION_INSTANT]);
    await insertOverride({ overrideId: 'override-active-replacement' });

    await assert.rejects(() => insertOverride({ overrideId: 'override-cross-authority-account', accountId: 'account-2', capabilityId: 'access.retired' }), /foreign key/);
    await assert.rejects(() => insertOverride({ overrideId: 'override-unknown-capability', capabilityId: 'access.unknown', status: 'revoked', revokedAt: FOUNDATION_INSTANT }), /foreign key/);
    await assert.rejects(
      () => insertOverride({ overrideId: '   ', capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_override_id_check',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-blank-authority', authorityId: '   ', capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_authority_id_check',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-blank-account', accountId: '   ', capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_account_id_check',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-blank-capability', capabilityId: '   ', status: 'revoked', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_capability_id_check',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-invalid-effect', capabilityId: 'access.retired', effect: 'grant', status: 'revoked', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_effect_check',
    );
    await facade.query('ALTER TABLE vnext_control_plane.vnext_capability_overrides DROP CONSTRAINT vnext_capability_overrides_check2');
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-invalid-status', capabilityId: 'access.retired', status: 'pending' }),
      error => error && error.constraint === 'vnext_capability_overrides_status_check',
    );
    await facade.query("ALTER TABLE vnext_control_plane.vnext_capability_overrides ADD CONSTRAINT vnext_capability_overrides_check2 CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL) OR (status = 'expired' AND ends_at IS NOT NULL AND revoked_at IS NULL))");
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-zero-version', capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT, rowVersion: 0 }),
      error => error && error.constraint === 'vnext_capability_overrides_row_version_check',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-fractional-version', capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT, rowVersion: 1.5 }),
      /invalid input syntax for type bigint/,
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-updated-before-created', capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT, updatedAt: '2026-08-14T23:59:59.000Z' }),
      error => error && error.constraint === 'vnext_capability_overrides_check',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-end-at-start', capabilityId: 'access.retired', status: 'expired', endsAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_check1',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-active-revoked', capabilityId: 'access.retired', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_check2',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-revoked-missing-time', capabilityId: 'access.retired', status: 'revoked' }),
      error => error && error.constraint === 'vnext_capability_overrides_check2',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-expired-missing-end', capabilityId: 'access.retired', status: 'expired' }),
      error => error && error.constraint === 'vnext_capability_overrides_check2',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-expired-revoked', capabilityId: 'access.retired', status: 'expired', endsAt: '2026-08-15T00:01:00.000Z', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_capability_overrides_check2',
    );
    await assert.rejects(
      () => insertOverride({ overrideId: 'override-negative-infinite-created', capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT, createdAt: '-infinity' }),
      error => error && error.constraint === 'vnext_capability_overrides_created_at_check',
    );
    for (const [overrideId, field, value, constraint] of [
      ['override-infinite-start', 'startsAt', 'infinity', 'vnext_capability_overrides_starts_at_check'],
      ['override-infinite-end', 'endsAt', 'infinity', 'vnext_capability_overrides_ends_at_check'],
      ['override-infinite-updated', 'updatedAt', 'infinity', 'vnext_capability_overrides_updated_at_check'],
      ['override-infinite-revoked', 'revokedAt', '-infinity', 'vnext_capability_overrides_revoked_at_check'],
    ]) {
      const input = { overrideId, capabilityId: 'access.retired', status: 'revoked', revokedAt: FOUNDATION_INSTANT };
      input[field] = value;
      await assert.rejects(() => insertOverride(input), error => error && error.constraint === constraint);
    }
  });
  await assert.rejects(
    () => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
      "INSERT INTO vnext_control_plane.vnext_capability_overrides (override_id, authority_id, account_id, capability_id, effect, status, starts_at, row_version, created_at, updated_at) VALUES ('verifier-write', 'authority-1', 'account-1', 'access.manage', 'allow', 'active', $1, 1, $1, $1)",
      [FOUNDATION_INSTANT],
    )),
  );
  await assert.rejects(
    () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
      'SELECT * FROM vnext_control_plane.vnext_capability_overrides',
    )),
  );
}

async function assertDataScopeGrantSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const insertScope = ({
      scopeGrantId,
      authorityId = 'authority-1',
      accountId = 'account-1',
      scopeType = 'teacher_profile',
      scopeValueHash = 'opaque-scope-value',
      effect = 'allow',
      status = 'active',
      startsAt = FOUNDATION_INSTANT,
      endsAt = null,
      rowVersion = 1,
      createdAt = FOUNDATION_INSTANT,
      updatedAt = FOUNDATION_INSTANT,
      revokedAt = null,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_data_scope_grants (scope_grant_id, authority_id, account_id, scope_type, scope_value_hash, effect, status, starts_at, ends_at, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [scopeGrantId, authorityId, accountId, scopeType, scopeValueHash, effect, status, startsAt, endsAt, rowVersion, createdAt, updatedAt, revokedAt],
    );

    await insertScope({ scopeGrantId: 'scope-teacher' });
    await assert.rejects(() => insertScope({ scopeGrantId: 'scope-same-tuple-deny', effect: 'deny' }), /duplicate key/);
    await insertScope({ scopeGrantId: 'scope-student', scopeType: 'student_profile', scopeValueHash: 'opaque-student', effect: 'deny' });
    await insertScope({ scopeGrantId: 'scope-school', scopeType: 'school', scopeValueHash: 'opaque-school' });
    await insertScope({ scopeGrantId: 'scope-household', scopeType: 'household', scopeValueHash: 'opaque-household' });
    await insertScope({ scopeGrantId: 'scope-resource-owner', scopeType: 'resource_owner', scopeValueHash: 'opaque-resource' });
    await insertScope({ scopeGrantId: 'scope-revoked-history', status: 'revoked', revokedAt: FOUNDATION_INSTANT });
    await insertScope({ scopeGrantId: 'scope-expired-history', status: 'expired', scopeValueHash: 'opaque-expired', endsAt: '2026-08-15T00:01:00.000Z' });
    await facade.query("UPDATE vnext_control_plane.vnext_data_scope_grants SET status = 'revoked', revoked_at = $1 WHERE scope_grant_id = 'scope-teacher'", [FOUNDATION_INSTANT]);
    await insertScope({ scopeGrantId: 'scope-active-replacement' });

    await assert.rejects(() => insertScope({ scopeGrantId: 'scope-cross-authority', accountId: 'account-2' }), /foreign key/);
    for (const [scopeGrantId, field, constraint] of [
      ['scope-blank-id', 'scopeGrantId', 'vnext_data_scope_grants_scope_grant_id_check'],
      ['scope-blank-authority', 'authorityId', 'vnext_data_scope_grants_authority_id_check'],
      ['scope-blank-account', 'accountId', 'vnext_data_scope_grants_account_id_check'],
      ['scope-blank-value', 'scopeValueHash', 'vnext_data_scope_grants_scope_value_hash_check'],
    ]) {
      const input = { scopeGrantId, status: 'revoked', revokedAt: FOUNDATION_INSTANT };
      input[field] = '   ';
      await assert.rejects(() => insertScope(input), error => error && error.constraint === constraint);
    }
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-invalid-type', scopeType: 'other', status: 'revoked', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_data_scope_grants_scope_type_check',
    );
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-invalid-effect', effect: 'grant', status: 'revoked', revokedAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_data_scope_grants_effect_check',
    );
    await facade.query('ALTER TABLE vnext_control_plane.vnext_data_scope_grants DROP CONSTRAINT vnext_data_scope_grants_check2');
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-invalid-status', status: 'pending' }),
      error => error && error.constraint === 'vnext_data_scope_grants_status_check',
    );
    await facade.query("ALTER TABLE vnext_control_plane.vnext_data_scope_grants ADD CONSTRAINT vnext_data_scope_grants_check2 CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL) OR (status = 'expired' AND ends_at IS NOT NULL AND revoked_at IS NULL))");
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-zero-version', status: 'revoked', revokedAt: FOUNDATION_INSTANT, rowVersion: 0 }),
      error => error && error.constraint === 'vnext_data_scope_grants_row_version_check',
    );
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-fractional-version', status: 'revoked', revokedAt: FOUNDATION_INSTANT, rowVersion: 1.5 }),
      /invalid input syntax for type bigint/,
    );
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-updated-before-created', status: 'revoked', revokedAt: FOUNDATION_INSTANT, updatedAt: '2026-08-14T23:59:59.000Z' }),
      error => error && error.constraint === 'vnext_data_scope_grants_check',
    );
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-end-at-start', status: 'expired', endsAt: FOUNDATION_INSTANT }),
      error => error && error.constraint === 'vnext_data_scope_grants_check1',
    );
    for (const [scopeGrantId, input] of [
      ['scope-active-revoked', { revokedAt: FOUNDATION_INSTANT }],
      ['scope-revoked-missing-time', { status: 'revoked' }],
      ['scope-expired-missing-end', { status: 'expired' }],
      ['scope-expired-revoked', { status: 'expired', endsAt: '2026-08-15T00:01:00.000Z', revokedAt: FOUNDATION_INSTANT }],
    ]) {
      await assert.rejects(() => insertScope({ scopeGrantId, ...input }), error => error && error.constraint === 'vnext_data_scope_grants_check2');
    }
    await assert.rejects(
      () => insertScope({ scopeGrantId: 'scope-negative-infinite-created', status: 'revoked', revokedAt: FOUNDATION_INSTANT, createdAt: '-infinity' }),
      error => error && error.constraint === 'vnext_data_scope_grants_created_at_check',
    );
    for (const [scopeGrantId, field, value, constraint] of [
      ['scope-infinite-start', 'startsAt', 'infinity', 'vnext_data_scope_grants_starts_at_check'],
      ['scope-infinite-end', 'endsAt', 'infinity', 'vnext_data_scope_grants_ends_at_check'],
      ['scope-infinite-updated', 'updatedAt', 'infinity', 'vnext_data_scope_grants_updated_at_check'],
      ['scope-infinite-revoked', 'revokedAt', '-infinity', 'vnext_data_scope_grants_revoked_at_check'],
    ]) {
      const input = { scopeGrantId, status: 'revoked', revokedAt: FOUNDATION_INSTANT };
      input[field] = value;
      await assert.rejects(() => insertScope(input), error => error && error.constraint === constraint);
    }
  });
  await assert.rejects(
    () => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
      "INSERT INTO vnext_control_plane.vnext_data_scope_grants (scope_grant_id, authority_id, account_id, scope_type, scope_value_hash, effect, status, starts_at, row_version, created_at, updated_at) VALUES ('verifier-write', 'authority-1', 'account-1', 'teacher_profile', 'opaque', 'allow', 'active', $1, 1, $1, $1)",
      [FOUNDATION_INSTANT],
    )),
  );
  await assert.rejects(
    () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_data_scope_grants')),
  );
}

async function assertProfileBindingSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query("INSERT INTO vnext_control_plane.vnext_accounts (account_id, authority_id, status, auth_version, access_version, revocation_version, row_version, created_at, updated_at) VALUES ('account-profile-2', 'authority-1', 'active', 1, 1, 1, 1, $1, $1)", [FOUNDATION_INSTANT]);
    const insertBinding = ({
      bindingId,
      authorityId = 'authority-1',
      accountId = 'account-1',
      profileType = 'teacher',
      profileId = 'profile-teacher-1',
      status = 'active',
      evidenceHash = 'opaque-evidence',
      rowVersion = 1,
      createdAt = FOUNDATION_INSTANT,
      updatedAt = FOUNDATION_INSTANT,
      revokedAt = null,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_profile_bindings (binding_id, authority_id, account_id, profile_type, profile_id, status, evidence_hash, row_version, created_at, updated_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [bindingId, authorityId, accountId, profileType, profileId, status, evidenceHash, rowVersion, createdAt, updatedAt, revokedAt],
    );
    await insertBinding({ bindingId: 'binding-teacher' });
    await assert.rejects(() => insertBinding({ bindingId: 'binding-account-type-conflict', profileId: 'profile-teacher-2' }), error => error && error.constraint === 'vnext_profile_bindings_one_active_account_type');
    await assert.rejects(() => insertBinding({ bindingId: 'binding-profile-conflict', accountId: 'account-profile-2' }), error => error && error.constraint === 'vnext_profile_bindings_one_active_profile');
    await insertBinding({ bindingId: 'binding-student', profileType: 'student', profileId: 'profile-teacher-1' });
    await insertBinding({ bindingId: 'binding-pending-1', status: 'pending' });
    await insertBinding({ bindingId: 'binding-pending-2', status: 'pending' });
    await facade.query("UPDATE vnext_control_plane.vnext_profile_bindings SET status = 'revoked', revoked_at = $1 WHERE binding_id = 'binding-teacher'", [FOUNDATION_INSTANT]);
    await insertBinding({ bindingId: 'binding-active-replacement' });
    await assert.rejects(() => insertBinding({ bindingId: 'binding-cross-authority', accountId: 'account-2', profileId: 'profile-cross-authority' }), /foreign key/);
    for (const [bindingId, field, constraint] of [
      ['binding-blank-id', 'bindingId', 'vnext_profile_bindings_binding_id_check'],
      ['binding-blank-authority', 'authorityId', 'vnext_profile_bindings_authority_id_check'],
      ['binding-blank-account', 'accountId', 'vnext_profile_bindings_account_id_check'],
      ['binding-blank-profile', 'profileId', 'vnext_profile_bindings_profile_id_check'],
      ['binding-blank-evidence', 'evidenceHash', 'vnext_profile_bindings_evidence_hash_check'],
    ]) {
      const input = { bindingId, status: 'revoked', revokedAt: FOUNDATION_INSTANT };
      input[field] = '   ';
      await assert.rejects(() => insertBinding(input), error => error && error.constraint === constraint);
    }
    await assert.rejects(() => insertBinding({ bindingId: 'binding-invalid-type', profileType: 'other', status: 'revoked', revokedAt: FOUNDATION_INSTANT }), error => error && error.constraint === 'vnext_profile_bindings_profile_type_check');
    await facade.query('ALTER TABLE vnext_control_plane.vnext_profile_bindings DROP CONSTRAINT vnext_profile_bindings_check1');
    await assert.rejects(() => insertBinding({ bindingId: 'binding-invalid-status', status: 'other' }), error => error && error.constraint === 'vnext_profile_bindings_status_check');
    await facade.query("ALTER TABLE vnext_control_plane.vnext_profile_bindings ADD CONSTRAINT vnext_profile_bindings_check1 CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status IN ('active', 'pending') AND revoked_at IS NULL))");
    await assert.rejects(() => insertBinding({ bindingId: 'binding-zero-version', status: 'revoked', revokedAt: FOUNDATION_INSTANT, rowVersion: 0 }), error => error && error.constraint === 'vnext_profile_bindings_row_version_check');
    await assert.rejects(() => insertBinding({ bindingId: 'binding-fractional-version', status: 'revoked', revokedAt: FOUNDATION_INSTANT, rowVersion: 1.5 }), /invalid input syntax for type bigint/);
    await assert.rejects(() => insertBinding({ bindingId: 'binding-updated-before-created', status: 'revoked', revokedAt: FOUNDATION_INSTANT, updatedAt: '2026-08-14T23:59:59.000Z' }), error => error && error.constraint === 'vnext_profile_bindings_check');
    for (const [bindingId, input] of [['binding-active-revoked', { revokedAt: FOUNDATION_INSTANT }], ['binding-pending-revoked', { status: 'pending', revokedAt: FOUNDATION_INSTANT }], ['binding-revoked-missing-time', { status: 'revoked' }]]) {
      await assert.rejects(() => insertBinding({ bindingId, ...input }), error => error && error.constraint === 'vnext_profile_bindings_check1');
    }
    for (const [bindingId, field, value, constraint] of [['binding-infinite-created', 'createdAt', '-infinity', 'vnext_profile_bindings_created_at_check'], ['binding-infinite-updated', 'updatedAt', 'infinity', 'vnext_profile_bindings_updated_at_check'], ['binding-infinite-revoked', 'revokedAt', '-infinity', 'vnext_profile_bindings_revoked_at_check']]) {
      const input = { bindingId, status: 'revoked', revokedAt: FOUNDATION_INSTANT };
      input[field] = value;
      await assert.rejects(() => insertBinding(input), error => error && error.constraint === constraint);
    }
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_profile_bindings (binding_id, authority_id, account_id, profile_type, profile_id, status, evidence_hash, row_version, created_at, updated_at) VALUES ('verifier-write', 'authority-1', 'account-1', 'teacher', 'profile', 'active', 'opaque', 1, $1, $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_profile_bindings')));
}

async function assertVerifiedContactSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    await facade.query("INSERT INTO vnext_control_plane.vnext_accounts (account_id, authority_id, status, auth_version, access_version, revocation_version, row_version, created_at, updated_at) VALUES ('account-contact-2', 'authority-1', 'active', 1, 1, 1, 1, $1, $1)", [FOUNDATION_INSTANT]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ('authority-contact-2', 'active', $1, $1)", [FOUNDATION_INSTANT]);
    await facade.query("INSERT INTO vnext_control_plane.vnext_accounts (account_id, authority_id, status, auth_version, access_version, revocation_version, row_version, created_at, updated_at) VALUES ('account-contact-foreign', 'authority-contact-2', 'active', 1, 1, 1, 1, $1, $1)", [FOUNDATION_INSTANT]);
    const insertContact = ({
      contactId,
      authorityId = 'authority-1',
      accountId = 'account-1',
      contactType = 'phone',
      normalizedValueHash = 'opaque-contact-value',
      verificationState = 'verified',
      verificationEvidenceHash = 'opaque-contact-evidence',
      verifiedAt = FOUNDATION_INSTANT,
      revokedAt = null,
      rowVersion = 1,
      createdAt = FOUNDATION_INSTANT,
      updatedAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_verified_contacts (contact_id, authority_id, account_id, contact_type, normalized_value_hash, verification_state, verification_evidence_hash, verified_at, revoked_at, row_version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [contactId, authorityId, accountId, contactType, normalizedValueHash, verificationState, verificationEvidenceHash, verifiedAt, revokedAt, rowVersion, createdAt, updatedAt],
    );
    await insertContact({ contactId: 'contact-phone' });
    await insertContact({ contactId: 'contact-openid', contactType: 'wechat_openid' });
    await insertContact({ contactId: 'contact-unionid', contactType: 'wechat_unionid' });
    await assert.rejects(() => insertContact({ contactId: 'contact-identity-conflict', accountId: 'account-contact-2' }), error => error && error.constraint === 'vnext_verified_contacts_authority_id_contact_type_normalize_key');
    await facade.query("UPDATE vnext_control_plane.vnext_verified_contacts SET verification_state = 'revoked', revoked_at = $1 WHERE contact_id = 'contact-phone'", [FOUNDATION_INSTANT]);
    await assert.rejects(() => insertContact({ contactId: 'contact-revoked-identity-conflict', accountId: 'account-contact-2' }), error => error && error.constraint === 'vnext_verified_contacts_authority_id_contact_type_normalize_key');
    await insertContact({ contactId: 'contact-other-authority', authorityId: 'authority-contact-2', accountId: 'account-contact-foreign' });
    await assert.rejects(() => insertContact({ contactId: 'contact-cross-authority', authorityId: 'authority-1', accountId: 'account-contact-foreign', normalizedValueHash: 'opaque-cross-authority' }), /foreign key/);
    for (const [contactId, field, constraint] of [
      ['contact-blank-id', 'contactId', 'vnext_verified_contacts_contact_id_check'],
      ['contact-blank-authority', 'authorityId', 'vnext_verified_contacts_authority_id_check'],
      ['contact-blank-account', 'accountId', 'vnext_verified_contacts_account_id_check'],
      ['contact-blank-value', 'normalizedValueHash', 'vnext_verified_contacts_normalized_value_hash_check'],
      ['contact-blank-evidence', 'verificationEvidenceHash', 'vnext_verified_contacts_verification_evidence_hash_check'],
    ]) {
      const input = { contactId, verificationState: 'revoked', revokedAt: FOUNDATION_INSTANT };
      input[field] = '   ';
      await assert.rejects(() => insertContact(input), error => error && error.constraint === constraint);
    }
    await assert.rejects(() => insertContact({ contactId: 'contact-invalid-type', contactType: 'other', verificationState: 'revoked', revokedAt: FOUNDATION_INSTANT }), error => error && error.constraint === 'vnext_verified_contacts_contact_type_check');
    await facade.query('ALTER TABLE vnext_control_plane.vnext_verified_contacts DROP CONSTRAINT vnext_verified_contacts_check1');
    await assert.rejects(() => insertContact({ contactId: 'contact-invalid-state', verificationState: 'other' }), error => error && error.constraint === 'vnext_verified_contacts_verification_state_check');
    await facade.query("ALTER TABLE vnext_control_plane.vnext_verified_contacts ADD CONSTRAINT vnext_verified_contacts_check1 CHECK ((verification_state = 'verified' AND verified_at IS NOT NULL AND revoked_at IS NULL) OR (verification_state = 'revoked' AND verified_at IS NOT NULL AND revoked_at IS NOT NULL))");
    await assert.rejects(() => insertContact({ contactId: 'contact-zero-version', rowVersion: 0, verificationState: 'revoked', revokedAt: FOUNDATION_INSTANT }), error => error && error.constraint === 'vnext_verified_contacts_row_version_check');
    await assert.rejects(() => insertContact({ contactId: 'contact-updated-before-created', verificationState: 'revoked', revokedAt: FOUNDATION_INSTANT, updatedAt: '2026-08-14T23:59:59.000Z' }), error => error && error.constraint === 'vnext_verified_contacts_check');
    for (const [contactId, input] of [
      ['contact-verified-missing-time', { verifiedAt: null }],
      ['contact-verified-revoked-time', { revokedAt: FOUNDATION_INSTANT }],
      ['contact-revoked-missing-time', { verificationState: 'revoked', revokedAt: null }],
    ]) {
      await assert.rejects(() => insertContact({ contactId, ...input }), error => error && error.constraint === 'vnext_verified_contacts_check1');
    }
    for (const [contactId, field, value, constraint] of [
      ['contact-infinite-created', 'createdAt', '-infinity', 'vnext_verified_contacts_created_at_check'],
      ['contact-infinite-updated', 'updatedAt', 'infinity', 'vnext_verified_contacts_updated_at_check'],
      ['contact-infinite-verified', 'verifiedAt', 'infinity', 'vnext_verified_contacts_verified_at_check'],
      ['contact-infinite-revoked', 'revokedAt', '-infinity', 'vnext_verified_contacts_revoked_at_check'],
    ]) {
      const input = { contactId, verificationState: 'revoked', revokedAt: FOUNDATION_INSTANT };
      input[field] = value;
      await assert.rejects(() => insertContact(input), error => error && error.constraint === constraint);
    }
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_verified_contacts (contact_id, authority_id, account_id, contact_type, normalized_value_hash, verification_state, verification_evidence_hash, verified_at, row_version, created_at, updated_at) VALUES ('verifier-write', 'authority-1', 'account-1', 'phone', 'opaque', 'verified', 'opaque', $1, 1, $1, $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_verified_contacts')));
}

async function assertAuthorizationCommandReceiptSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const insertReceipt = ({
      receiptId,
      authorityId = 'authority-1',
      actorKey = 'actor-1',
      actorAccountId = 'account-1',
      idempotencyKey = 'idempotency-1',
      commandType = 'generic.command',
      targetKind = 'generic_target',
      targetId = 'target-1',
      requestHash = 'a'.repeat(64),
      expectedRowVersion = null,
      outcome = 'accepted',
      resultCode = 'GENERIC_ACCEPTED',
      resultJson = '{"ok":true}',
      resultHash = 'b'.repeat(64),
      committedAuthVersion = null,
      committedAccessVersion = null,
      committedRevocationVersion = null,
      committedTargetRowVersion = null,
      createdAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorization_command_receipts (receipt_id, authority_id, actor_key, actor_account_id, idempotency_key, command_type, target_kind, target_id, canonical_request_sha256, expected_row_version, outcome, result_code, canonical_result_json, canonical_result_sha256, committed_auth_version, committed_access_version, committed_revocation_version, committed_target_row_version, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)',
      [receiptId, authorityId, actorKey, actorAccountId, idempotencyKey, commandType, targetKind, targetId, requestHash, expectedRowVersion, outcome, resultCode, resultJson, resultHash, committedAuthVersion, committedAccessVersion, committedRevocationVersion, committedTargetRowVersion, createdAt],
    );
    await insertReceipt({ receiptId: 'receipt-object' });
    await insertReceipt({ receiptId: 'receipt-array', actorKey: 'actor-array', idempotencyKey: 'idempotency-array', outcome: 'rejected', resultJson: '[]', expectedRowVersion: 0 });
    await insertReceipt({ receiptId: 'receipt-scalar', actorKey: 'actor-scalar', idempotencyKey: 'idempotency-scalar', outcome: 'noop', resultJson: 'true', actorAccountId: null, committedAuthVersion: 1, committedAccessVersion: 1, committedRevocationVersion: 1, committedTargetRowVersion: 1 });
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-duplicate-idempotency' }), error => error && error.constraint === 'vnext_authorization_command_r_authority_id_actor_key_idempo_key');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-cross-authority', authorityId: 'authority-1', actorAccountId: 'account-contact-foreign', actorKey: 'actor-cross', idempotencyKey: 'idempotency-cross' }), /foreign key/);
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-missing-authority', authorityId: 'authority-missing', actorAccountId: null, actorKey: 'actor-missing-authority', idempotencyKey: 'key-missing-authority' }), /foreign key/);
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-missing-account', actorAccountId: 'account-missing', actorKey: 'actor-missing-account', idempotencyKey: 'key-missing-account' }), /foreign key/);
    for (const [receiptId, field, constraint] of [
      ['receipt-blank-id', 'receiptId', 'vnext_authorization_command_receipts_receipt_id_check'],
      ['receipt-blank-authority', 'authorityId', 'vnext_authorization_command_receipts_authority_id_check'],
      ['receipt-blank-actor', 'actorKey', 'vnext_authorization_command_receipts_actor_key_check'],
      ['receipt-blank-actor-account', 'actorAccountId', 'vnext_authorization_command_receipts_actor_account_id_check'],
      ['receipt-blank-idempotency', 'idempotencyKey', 'vnext_authorization_command_receipts_idempotency_key_check'],
      ['receipt-blank-command', 'commandType', 'vnext_authorization_command_receipts_command_type_check'],
      ['receipt-blank-kind', 'targetKind', 'vnext_authorization_command_receipts_target_kind_check'],
      ['receipt-blank-target', 'targetId', 'vnext_authorization_command_receipts_target_id_check'],
      ['receipt-blank-code', 'resultCode', 'vnext_authorization_command_receipts_result_code_check'],
    ]) {
      const input = { receiptId, actorKey: `actor-${receiptId}`, idempotencyKey: `key-${receiptId}` };
      input[field] = '   ';
      await assert.rejects(() => insertReceipt(input), error => error && error.constraint === constraint);
    }
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-invalid-outcome', actorKey: 'actor-outcome', idempotencyKey: 'key-outcome', outcome: 'other' }), error => error && error.constraint === 'vnext_authorization_command_receipts_outcome_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-invalid-json', actorKey: 'actor-json', idempotencyKey: 'key-json', resultJson: '{' }), error => error && error.constraint === 'vnext_authorization_command_receipt_canonical_result_json_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-duplicate-json', actorKey: 'actor-duplicate-json', idempotencyKey: 'key-duplicate-json', resultJson: '{"a":1,"a":2}' }), error => error && error.constraint === 'vnext_authorization_command_receipt_canonical_result_json_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-short-request-hash', actorKey: 'actor-request-hash', idempotencyKey: 'key-request-hash', requestHash: 'a'.repeat(63) }), error => error && error.constraint === 'vnext_authorization_command_rece_canonical_request_sha256_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-upper-request-hash', actorKey: 'actor-upper-request-hash', idempotencyKey: 'key-upper-request-hash', requestHash: 'A'.repeat(64) }), error => error && error.constraint === 'vnext_authorization_command_rece_canonical_request_sha256_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-short-result-hash', actorKey: 'actor-short-result-hash', idempotencyKey: 'key-short-result-hash', resultHash: 'b'.repeat(63) }), error => error && error.constraint === 'vnext_authorization_command_recei_canonical_result_sha256_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-upper-result-hash', actorKey: 'actor-result-hash', idempotencyKey: 'key-result-hash', resultHash: 'B'.repeat(64) }), error => error && error.constraint === 'vnext_authorization_command_recei_canonical_result_sha256_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-negative-expected', actorKey: 'actor-expected', idempotencyKey: 'key-expected', expectedRowVersion: -1 }), error => error && error.constraint === 'vnext_authorization_command_receipts_expected_row_version_check');
    await assert.rejects(() => insertReceipt({ receiptId: 'receipt-fractional-expected', actorKey: 'actor-fractional-expected', idempotencyKey: 'key-fractional-expected', expectedRowVersion: 1.5 }), error => error && error.code === '22P02');
    for (const [receiptId, field, constraint] of [
      ['receipt-zero-auth', 'committedAuthVersion', 'vnext_authorization_command_receip_committed_auth_version_check'],
      ['receipt-zero-access', 'committedAccessVersion', 'vnext_authorization_command_rece_committed_access_version_check'],
      ['receipt-zero-revocation', 'committedRevocationVersion', 'vnext_authorization_command__committed_revocation_version_check'],
      ['receipt-zero-target', 'committedTargetRowVersion', 'vnext_authorization_command__committed_target_row_version_check'],
    ]) {
      const input = { receiptId, actorKey: `actor-${receiptId}`, idempotencyKey: `key-${receiptId}` };
      input[field] = 0;
      await assert.rejects(() => insertReceipt(input), error => error && error.constraint === constraint);
    }
    for (const [receiptId, field] of [
      ['receipt-fractional-auth', 'committedAuthVersion'],
      ['receipt-fractional-access', 'committedAccessVersion'],
      ['receipt-fractional-revocation', 'committedRevocationVersion'],
      ['receipt-fractional-target', 'committedTargetRowVersion'],
    ]) {
      const input = { receiptId, actorKey: `actor-${receiptId}`, idempotencyKey: `key-${receiptId}` };
      input[field] = 1.5;
      await assert.rejects(() => insertReceipt(input), error => error && error.code === '22P02');
    }
    for (const [receiptId, createdAt] of [['receipt-infinite-created', 'infinity'], ['receipt-negative-infinite-created', '-infinity']]) {
      await assert.rejects(() => insertReceipt({ receiptId, actorKey: `actor-${receiptId}`, idempotencyKey: `key-${receiptId}`, createdAt }), error => error && error.constraint === 'vnext_authorization_command_receipts_created_at_check');
    }
    const before = await facade.query("SELECT receipt_id, outcome, canonical_result_json FROM vnext_control_plane.vnext_authorization_command_receipts WHERE receipt_id = 'receipt-object'");
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_authorization_command_receipts SET outcome = 'noop' WHERE receipt_id = 'receipt-object'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query("DELETE FROM vnext_control_plane.vnext_authorization_command_receipts WHERE receipt_id = 'receipt-object'"), error => error && error.code === 'P0001');
    const after = await facade.query("SELECT receipt_id, outcome, canonical_result_json FROM vnext_control_plane.vnext_authorization_command_receipts WHERE receipt_id = 'receipt-object'");
    assert.deepStrictEqual(after.rows, before.rows);
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_authorization_command_receipts (receipt_id, authority_id, actor_key, idempotency_key, command_type, target_kind, target_id, canonical_request_sha256, outcome, result_code, canonical_result_json, canonical_result_sha256, created_at) VALUES ('verifier-write', 'authority-1', 'actor-verifier', 'key-verifier', 'generic', 'target', 'target', repeat('a', 64), 'accepted', 'OK', '{}', repeat('b', 64), $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_command_receipts')));
}

async function assertAuthorizationAuditEventSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const insertReceipt = ({
      receiptId,
      authorityId = 'authority-1',
      actorKey = 'audit-actor',
      idempotencyKey = 'audit-idempotency',
    }) => facade.query(
      "INSERT INTO vnext_control_plane.vnext_authorization_command_receipts (receipt_id, authority_id, actor_key, actor_account_id, idempotency_key, command_type, target_kind, target_id, canonical_request_sha256, outcome, result_code, canonical_result_json, canonical_result_sha256, created_at) VALUES ($1, $2, $3, 'account-1', $4, 'generic.command', 'generic_target', 'target-audit', repeat('a', 64), 'accepted', 'GENERIC_ACCEPTED', '{}', repeat('b', 64), $5)",
      [receiptId, authorityId, actorKey, idempotencyKey, FOUNDATION_INSTANT],
    );
    const insertAudit = ({
      eventId,
      authorityId = 'authority-1',
      receiptId = 'audit-receipt-1',
      reasonCode = 'generic.reason',
      contextHash = 'c'.repeat(64),
      createdAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorization_audit_events (event_id, authority_id, receipt_id, reason_code, context_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [eventId, authorityId, receiptId, reasonCode, contextHash, createdAt],
    );
    await insertReceipt({ receiptId: 'audit-receipt-1' });
    await insertAudit({ eventId: 'audit-event-1' });
    await assert.rejects(() => insertAudit({ eventId: 'audit-event-1', receiptId: 'receipt-array' }), error => error && error.constraint === 'vnext_authorization_audit_events_pkey');
    await assert.rejects(() => insertAudit({ eventId: 'audit-event-duplicate-receipt' }), error => error && error.constraint === 'vnext_authorization_audit_events_authority_id_receipt_id_key');
    await facade.query("INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ('authority-audit-2', 'active', $1, $1)", [FOUNDATION_INSTANT]);
    await assert.rejects(() => insertAudit({ eventId: 'audit-event-cross-authority', authorityId: 'authority-audit-2' }), /foreign key/);
    await assert.rejects(() => insertAudit({ eventId: 'audit-event-missing-authority', authorityId: 'authority-audit-missing', receiptId: 'receipt-array' }), /foreign key/);
    await assert.rejects(() => insertAudit({ eventId: 'audit-event-missing-receipt', receiptId: 'audit-receipt-missing' }), /foreign key/);
    for (const [eventId, field, constraint] of [
      ['audit-blank-event', 'eventId', 'vnext_authorization_audit_events_event_id_check'],
      ['audit-blank-authority', 'authorityId', 'vnext_authorization_audit_events_authority_id_check'],
      ['audit-blank-receipt', 'receiptId', 'vnext_authorization_audit_events_receipt_id_check'],
      ['audit-blank-reason', 'reasonCode', 'vnext_authorization_audit_events_reason_code_check'],
    ]) {
      const input = { eventId, receiptId: 'receipt-array' };
      input[field] = '   ';
      await assert.rejects(() => insertAudit(input), error => error && error.constraint === constraint);
    }
    await assert.rejects(() => insertAudit({ eventId: 'audit-short-hash', receiptId: 'receipt-array', contextHash: 'c'.repeat(63) }), error => error && error.constraint === 'vnext_authorization_audit_events_context_sha256_check');
    await assert.rejects(() => insertAudit({ eventId: 'audit-upper-hash', receiptId: 'receipt-array', contextHash: 'C'.repeat(64) }), error => error && error.constraint === 'vnext_authorization_audit_events_context_sha256_check');
    for (const [eventId, createdAt] of [['audit-infinite-created', 'infinity'], ['audit-negative-infinite-created', '-infinity']]) {
      await assert.rejects(() => insertAudit({ eventId, receiptId: 'receipt-array', createdAt }), error => error && error.constraint === 'vnext_authorization_audit_events_created_at_check');
    }
    const before = await facade.query("SELECT event_id, reason_code, context_sha256 FROM vnext_control_plane.vnext_authorization_audit_events WHERE event_id = 'audit-event-1'");
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_authorization_audit_events SET reason_code = 'changed' WHERE event_id = 'audit-event-1'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query("DELETE FROM vnext_control_plane.vnext_authorization_audit_events WHERE event_id = 'audit-event-1'"), error => error && error.code === 'P0001');
    const after = await facade.query("SELECT event_id, reason_code, context_sha256 FROM vnext_control_plane.vnext_authorization_audit_events WHERE event_id = 'audit-event-1'");
    assert.deepStrictEqual(after.rows, before.rows);
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_authorization_audit_events (event_id, authority_id, receipt_id, reason_code, context_sha256, created_at) VALUES ('audit-verifier-write', 'authority-1', 'receipt-array', 'generic.reason', repeat('c', 64), $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_audit_events')));
}

async function assertAuthorizationOutboxEventSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const insert = ({ eventId, authorityId = 'authority-1', receiptId = 'audit-receipt-1', eventType = 'generic.event', aggregateKind = 'generic_kind', aggregateId = 'aggregate-1', aggregateVersion = 1, payload = '{}', payloadHash = 'd'.repeat(64), occurredAt = FOUNDATION_INSTANT }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorization_outbox_events (event_id, authority_id, receipt_id, event_type, aggregate_kind, aggregate_id, aggregate_version, canonical_payload_json, payload_sha256, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [eventId, authorityId, receiptId, eventType, aggregateKind, aggregateId, aggregateVersion, payload, payloadHash, occurredAt],
    );
    await insert({ eventId: 'outbox-object' });
    await insert({ eventId: 'outbox-array', eventType: 'array.event', payload: '[]' });
    await insert({ eventId: 'outbox-scalar', eventType: 'scalar.event', payload: 'true' });
    await assert.rejects(() => insert({ eventId: 'outbox-object', eventType: 'duplicate.id' }), error => error && error.constraint === 'vnext_authorization_outbox_events_pkey');
    await assert.rejects(() => insert({ eventId: 'outbox-duplicate-tuple' }), error => error && error.constraint === 'vnext_authorization_outbox_ev_authority_id_receipt_id_event_key');
    await insert({ eventId: 'outbox-different-receipt', receiptId: 'receipt-array' });
    await insert({ eventId: 'outbox-different-type', eventType: 'generic.event.second' });
    await insert({ eventId: 'outbox-different-kind', aggregateKind: 'generic_kind_second' });
    await insert({ eventId: 'outbox-different-aggregate', aggregateId: 'aggregate-second' });
    await facade.query("INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ('authority-outbox-2', 'active', $1, $1)", [FOUNDATION_INSTANT]);
    await assert.rejects(() => insert({ eventId: 'outbox-missing-authority', authorityId: 'authority-outbox-missing', eventType: 'missing-authority' }), /foreign key/);
    await assert.rejects(() => insert({ eventId: 'outbox-cross-authority', authorityId: 'authority-outbox-2', eventType: 'cross-authority' }), /foreign key/);
    await assert.rejects(() => insert({ eventId: 'outbox-missing-receipt', receiptId: 'receipt-outbox-missing', eventType: 'missing-receipt' }), /foreign key/);
    for (const [eventId, field, constraint] of [['outbox-blank-id', 'eventId', 'vnext_authorization_outbox_events_event_id_check'], ['outbox-blank-authority', 'authorityId', 'vnext_authorization_outbox_events_authority_id_check'], ['outbox-blank-receipt', 'receiptId', 'vnext_authorization_outbox_events_receipt_id_check'], ['outbox-blank-type', 'eventType', 'vnext_authorization_outbox_events_event_type_check'], ['outbox-blank-kind', 'aggregateKind', 'vnext_authorization_outbox_events_aggregate_kind_check'], ['outbox-blank-aggregate', 'aggregateId', 'vnext_authorization_outbox_events_aggregate_id_check']]) {
      const input = { eventId, eventType: `event-${eventId}` }; input[field] = '   ';
      await assert.rejects(() => insert(input), error => error && error.constraint === constraint);
    }
    await assert.rejects(() => insert({ eventId: 'outbox-zero-version', eventType: 'zero.event', aggregateVersion: 0 }), error => error && error.constraint === 'vnext_authorization_outbox_events_aggregate_version_check');
    await assert.rejects(() => insert({ eventId: 'outbox-negative-version', eventType: 'negative.event', aggregateVersion: -1 }), error => error && error.constraint === 'vnext_authorization_outbox_events_aggregate_version_check');
    await assert.rejects(() => insert({ eventId: 'outbox-fractional-version', eventType: 'fractional.event', aggregateVersion: 1.5 }), error => error && error.code === '22P02');
    await assert.rejects(() => insert({ eventId: 'outbox-bad-json', eventType: 'json.event', payload: '{' }), error => error && error.constraint === 'vnext_authorization_outbox_events_canonical_payload_json_check');
    await assert.rejects(() => insert({ eventId: 'outbox-duplicate-json', eventType: 'dup-json.event', payload: '{"a":1,"a":2}' }), error => error && error.constraint === 'vnext_authorization_outbox_events_canonical_payload_json_check');
    await assert.rejects(() => insert({ eventId: 'outbox-short-hash', eventType: 'short-hash.event', payloadHash: 'd'.repeat(63) }), error => error && error.constraint === 'vnext_authorization_outbox_events_payload_sha256_check');
    await assert.rejects(() => insert({ eventId: 'outbox-upper-hash', eventType: 'upper-hash.event', payloadHash: 'D'.repeat(64) }), error => error && error.constraint === 'vnext_authorization_outbox_events_payload_sha256_check');
    for (const [eventId, occurredAt] of [['outbox-infinity', 'infinity'], ['outbox-negative-infinity', '-infinity']]) await assert.rejects(() => insert({ eventId, eventType: eventId, occurredAt }), error => error && error.constraint === 'vnext_authorization_outbox_events_occurred_at_check');
    const before = await facade.query("SELECT event_id, aggregate_version FROM vnext_control_plane.vnext_authorization_outbox_events WHERE event_id = 'outbox-object'");
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_authorization_outbox_events SET aggregate_version = 2 WHERE event_id = 'outbox-object'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query("DELETE FROM vnext_control_plane.vnext_authorization_outbox_events WHERE event_id = 'outbox-object'"), error => error && error.code === 'P0001');
    assert.deepStrictEqual((await facade.query("SELECT event_id, aggregate_version FROM vnext_control_plane.vnext_authorization_outbox_events WHERE event_id = 'outbox-object'")).rows, before.rows);
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_authorization_outbox_events (event_id, authority_id, receipt_id, event_type, aggregate_kind, aggregate_id, aggregate_version, canonical_payload_json, payload_sha256, occurred_at) VALUES ('outbox-verifier', 'authority-1', 'audit-receipt-1', 'event', 'kind', 'id', 1, '{}', repeat('d', 64), $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_outbox_events')));
}

async function assertBootstrapConsumptionSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const policyManifestSha256 = 'a'.repeat(64);
    const installationKeyFingerprint = 'd'.repeat(64);
    const resultJson = JSON.stringify({
      authorityId: 'authority-1',
      code: 'AUTHORITY_BOOTSTRAPPED',
      policyContractVersion: 1,
      policyManifestSha256,
      policyRevision: 1,
      publicationId: 'publication-1',
      status: 'accepted',
    });
    const insertReceipt = ({
      receiptId,
      authorityId = 'authority-1',
      actorKey = 'bootstrap:bootstrap-intent-1',
      actorAccountId = null,
      idempotencyKey,
      commandType = 'authority.bootstrap',
      targetKind = 'authority',
      targetId = authorityId,
      expectedRowVersion = 0,
      outcome = 'accepted',
      resultCode = 'AUTHORITY_BOOTSTRAPPED',
      committedAuthVersion = null,
      committedAccessVersion = null,
      committedRevocationVersion = null,
      committedTargetRowVersion = 1,
      canonicalResultJson = resultJson,
      createdAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorization_command_receipts (receipt_id, authority_id, actor_key, actor_account_id, idempotency_key, command_type, target_kind, target_id, canonical_request_sha256, expected_row_version, outcome, result_code, canonical_result_json, canonical_result_sha256, committed_auth_version, committed_access_version, committed_revocation_version, committed_target_row_version, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)',
      [receiptId, authorityId, actorKey, actorAccountId, idempotencyKey, commandType, targetKind, targetId, 'b'.repeat(64), expectedRowVersion, outcome, resultCode, canonicalResultJson, 'c'.repeat(64), committedAuthVersion, committedAccessVersion, committedRevocationVersion, committedTargetRowVersion, createdAt],
    );
    const insertMarker = ({
      markerKey = 'single-authority-bootstrap',
      intentId,
      receiptId,
      consumedAt = FOUNDATION_INSTANT,
      authorityId = 'authority-1',
      fingerprint = installationKeyFingerprint,
      policyHash = policyManifestSha256,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_bootstrap_consumptions (marker_key, bootstrap_intent_id, authority_id, installation_key_fingerprint, policy_manifest_sha256, receipt_id, consumed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [markerKey, intentId, authorityId, fingerprint, policyHash, receiptId, consumedAt],
    );

    await insertReceipt({ receiptId: 'bootstrap-ordinary-receipt', actorKey: 'ordinary-actor', idempotencyKey: 'ordinary-key' });
    await assert.rejects(
      () => insertMarker({ intentId: 'ordinary-intent', receiptId: 'bootstrap-ordinary-receipt' }),
      error => error && error.code === 'P0001' && error.message === 'VNEXT_BOOTSTRAP_MARKER_RECEIPT_INVALID',
    );
    assert.deepStrictEqual((await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_bootstrap_consumptions')).rows, [{ count: '0' }]);

    await insertReceipt({ receiptId: 'bootstrap-time-receipt', actorKey: 'bootstrap:time-intent', idempotencyKey: 'time-key' });
    await assert.rejects(
      () => insertMarker({ intentId: 'time-intent', receiptId: 'bootstrap-time-receipt', consumedAt: '2026-08-14T23:59:59.999Z' }),
      error => error && error.code === 'P0001',
    );
    assert.deepStrictEqual((await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_bootstrap_consumptions')).rows, [{ count: '0' }]);

    for (const [suffix, canonicalResultJson] of [
      ['missing-status', JSON.stringify({ authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', policyContractVersion: 1, policyManifestSha256, policyRevision: 1, publicationId: 'publication-1' })],
      ['extra-key', JSON.stringify({ authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', policyContractVersion: 1, policyManifestSha256, policyRevision: 1, publicationId: 'publication-1', status: 'accepted', extra: true })],
      ['boolean-version', JSON.stringify({ authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', policyContractVersion: true, policyManifestSha256, policyRevision: 1, publicationId: 'publication-1', status: 'accepted' })],
      ['string-version', JSON.stringify({ authorityId: 'authority-1', code: 'AUTHORITY_BOOTSTRAPPED', policyContractVersion: '1', policyManifestSha256, policyRevision: 1, publicationId: 'publication-1', status: 'accepted' })],
      ['fractional-version', resultJson.replace('"policyRevision":1', '"policyRevision":1.0')],
    ]) {
      const intentId = `result-${suffix}`;
      const receiptId = `bootstrap-result-${suffix}`;
      await insertReceipt({ receiptId, actorKey: `bootstrap:${intentId}`, idempotencyKey: `result-key-${suffix}`, canonicalResultJson });
      await assert.rejects(() => insertMarker({ intentId, receiptId }), error => error && error.code === 'P0001');
      assert.deepStrictEqual((await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_bootstrap_consumptions')).rows, [{ count: '0' }]);
    }

    for (const [suffix, receiptOverrides, markerOverrides] of [
      ['actor', { actorKey: 'ordinary-actor' }, {}],
      ['actor-account', { actorAccountId: 'account-1' }, {}],
      ['command', { commandType: 'other.command' }, {}],
      ['target-kind', { targetKind: 'other_target' }, {}],
      ['target-id', { targetId: 'other-authority' }, {}],
      ['outcome', { outcome: 'rejected' }, {}],
      ['result-code', { resultCode: 'OTHER_RESULT' }, {}],
      ['expected-version', { expectedRowVersion: 1 }, {}],
      ['committed-target-version', { committedTargetRowVersion: 2 }, {}],
      ['committed-auth-version', { committedAuthVersion: 1 }, {}],
      ['policy-hash', {}, { policyHash: 'e'.repeat(64) }],
      ['authority', {}, { authorityId: 'authority-2' }],
      ['intent', { actorKey: 'bootstrap:source-intent' }, { intentId: 'different-intent' }],
    ]) {
      const intentId = markerOverrides.intentId || `bound-${suffix}`;
      const receiptId = `bootstrap-bound-${suffix}`;
      await insertReceipt({ receiptId, actorKey: `bootstrap:${intentId}`, idempotencyKey: `bound-key-${suffix}`, ...receiptOverrides });
      await assert.rejects(() => insertMarker({ intentId, receiptId, ...markerOverrides }), error => error && error.code === 'P0001');
      assert.deepStrictEqual((await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_bootstrap_consumptions')).rows, [{ count: '0' }]);
    }

    await insertReceipt({ receiptId: 'bootstrap-receipt-1', actorKey: 'bootstrap:bootstrap-intent-1', idempotencyKey: 'bootstrap-key-1' });
    await insertMarker({ intentId: 'bootstrap-intent-1', receiptId: 'bootstrap-receipt-1' });
    assert.deepStrictEqual((await facade.query('SELECT marker_key, bootstrap_intent_id, authority_id, receipt_id FROM vnext_control_plane.vnext_bootstrap_consumptions')).rows, [{ marker_key: 'single-authority-bootstrap', bootstrap_intent_id: 'bootstrap-intent-1', authority_id: 'authority-1', receipt_id: 'bootstrap-receipt-1' }]);
    const foreignKeys = await facade.query("SELECT COUNT(*)::text AS count FROM pg_constraint WHERE conrelid = 'vnext_control_plane.vnext_bootstrap_consumptions'::regclass AND contype = 'f'");
    assert.deepStrictEqual(foreignKeys.rows, [{ count: '0' }]);
    const before = await facade.query('SELECT * FROM vnext_control_plane.vnext_bootstrap_consumptions');
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_bootstrap_consumptions SET bootstrap_intent_id = 'changed'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query('DELETE FROM vnext_control_plane.vnext_bootstrap_consumptions'), error => error && error.code === 'P0001');
    assert.deepStrictEqual((await facade.query('SELECT * FROM vnext_control_plane.vnext_bootstrap_consumptions')).rows, before.rows);
    await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DISABLE TRIGGER ALL');
    try {
      await facade.query("DELETE FROM vnext_control_plane.vnext_authorization_command_receipts WHERE receipt_id = 'bootstrap-receipt-1'");
    } finally {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ENABLE TRIGGER ALL');
    }
    assert.deepStrictEqual((await facade.query('SELECT * FROM vnext_control_plane.vnext_bootstrap_consumptions')).rows, before.rows);
    await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DISABLE TRIGGER ALL');
    try {
      await facade.query(
        "INSERT INTO vnext_control_plane.vnext_authorization_command_receipts (receipt_id, authority_id, actor_key, actor_account_id, idempotency_key, command_type, target_kind, target_id, canonical_request_sha256, expected_row_version, outcome, result_code, canonical_result_json, canonical_result_sha256, committed_auth_version, committed_access_version, committed_revocation_version, committed_target_row_version, created_at) VALUES ('bootstrap-receipt-1', 'authority-1', 'bootstrap:bootstrap-intent-1', NULL, 'bootstrap-key-1', 'authority.bootstrap', 'authority', 'authority-1', repeat('b', 64), 0, 'accepted', 'AUTHORITY_BOOTSTRAPPED', $1, repeat('c', 64), NULL, NULL, NULL, 1, $2)",
        [resultJson, FOUNDATION_INSTANT],
      );
    } finally {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ENABLE TRIGGER ALL');
    }
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_bootstrap_consumptions (marker_key, bootstrap_intent_id, authority_id, installation_key_fingerprint, policy_manifest_sha256, receipt_id, consumed_at) VALUES ('single-authority-bootstrap', 'verifier-intent', 'authority-1', repeat('d', 64), repeat('a', 64), 'bootstrap-receipt-1', $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_bootstrap_consumptions')));
}

async function assertAuthorizationPolicyPublicationSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const bootstrapHash = 'a'.repeat(64);
    const insertPublication = ({
      publicationId,
      authorityId = 'authority-1',
      receiptId,
      policyRevision,
      policyContractVersion = 1,
      manifestJson = '{"version":1}',
      policyManifestSha256,
      publishedAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorization_policy_publications (publication_id, authority_id, receipt_id, policy_revision, policy_contract_version, canonical_manifest_json, policy_manifest_sha256, published_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [publicationId, authorityId, receiptId, policyRevision, policyContractVersion, manifestJson, policyManifestSha256, publishedAt],
    );
    await insertPublication({
      publicationId: 'publication-1',
      receiptId: 'bootstrap-receipt-1',
      policyRevision: 1,
      policyManifestSha256: bootstrapHash,
    });
    assert.deepStrictEqual((await facade.query("SELECT publication_id, policy_revision::text AS policy_revision, policy_manifest_sha256 FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id = 'authority-1'" )).rows, [{ publication_id: 'publication-1', policy_revision: '1', policy_manifest_sha256: bootstrapHash }]);
    const bootstrapBefore = await facade.query("SELECT * FROM vnext_control_plane.vnext_authorization_policy_publications WHERE publication_id = 'publication-1'");
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_authorization_policy_publications SET policy_revision = 2 WHERE publication_id = 'publication-1'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query("DELETE FROM vnext_control_plane.vnext_authorization_policy_publications WHERE publication_id = 'publication-1'"), error => error && error.code === 'P0001');
    assert.deepStrictEqual((await facade.query("SELECT * FROM vnext_control_plane.vnext_authorization_policy_publications WHERE publication_id = 'publication-1'")).rows, bootstrapBefore.rows);

    await facade.query("INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ('authority-policy-2', 'active', $1, $1)", [FOUNDATION_INSTANT]);
    const insertPolicyReceipt = ({ receiptId, idempotencyKey, publicationId, policyRevision, policyManifestSha256, authorityId = 'authority-policy-2', actorKey = 'policy-actor', actorAccountId = null, resultCode = 'POLICY_PUBLISHED', commandType = 'authorization_policy.publish', targetKind = 'authorization_policy', targetId = authorityId, outcome = 'accepted', expectedRowVersion = policyRevision - 1, committedTargetRowVersion = policyRevision, canonicalResultJson }) => {
      const resultJson = canonicalResultJson || JSON.stringify({ authorityId, code: resultCode, policyContractVersion: 1, policyManifestSha256, policyRevision, publicationId, status: 'accepted' });
      return facade.query(
        'INSERT INTO vnext_control_plane.vnext_authorization_command_receipts (receipt_id, authority_id, actor_key, actor_account_id, idempotency_key, command_type, target_kind, target_id, canonical_request_sha256, expected_row_version, outcome, result_code, canonical_result_json, canonical_result_sha256, committed_auth_version, committed_access_version, committed_revocation_version, committed_target_row_version, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, repeat(\'d\', 64), $9, $10, $11, $12, repeat(\'e\', 64), NULL, NULL, NULL, $13, $14)',
        [receiptId, authorityId, actorKey, actorAccountId, idempotencyKey, commandType, targetKind, targetId, expectedRowVersion, outcome, resultCode, resultJson, committedTargetRowVersion, FOUNDATION_INSTANT],
      );
    };
    const hashOne = 'b'.repeat(64);
    await insertPolicyReceipt({ receiptId: 'policy-receipt-1', idempotencyKey: 'policy-key-1', publicationId: 'policy-publication-1', policyRevision: 1, policyManifestSha256: hashOne });
    await insertPublication({ publicationId: 'policy-publication-1', authorityId: 'authority-policy-2', receiptId: 'policy-receipt-1', policyRevision: 1, policyManifestSha256: hashOne });
    await insertPolicyReceipt({ receiptId: 'policy-receipt-unchanged', idempotencyKey: 'policy-key-unchanged', publicationId: 'policy-publication-unchanged', policyRevision: 2, policyManifestSha256: hashOne });
    await assert.rejects(() => insertPublication({ publicationId: 'policy-publication-unchanged', authorityId: 'authority-policy-2', receiptId: 'policy-receipt-unchanged', policyRevision: 2, policyManifestSha256: hashOne }), error => error && error.code === 'P0001' && error.message === 'VNEXT_POLICY_UNCHANGED');
    const hashTwo = 'c'.repeat(64);
    await insertPolicyReceipt({ receiptId: 'policy-receipt-2', idempotencyKey: 'policy-key-2', publicationId: 'policy-publication-2', policyRevision: 2, policyManifestSha256: hashTwo });
    await insertPublication({ publicationId: 'policy-publication-2', authorityId: 'authority-policy-2', receiptId: 'policy-receipt-2', policyRevision: 2, policyManifestSha256: hashTwo });
    await insertPolicyReceipt({ receiptId: 'policy-receipt-bad', idempotencyKey: 'policy-key-bad', publicationId: 'policy-publication-bad', policyRevision: 3, policyManifestSha256: 'f'.repeat(64), resultCode: 'OTHER_RESULT' });
    await assert.rejects(() => insertPublication({ publicationId: 'policy-publication-bad', authorityId: 'authority-policy-2', receiptId: 'policy-receipt-bad', policyRevision: 3, policyManifestSha256: 'f'.repeat(64) }), error => error && error.code === 'P0001' && error.message === 'VNEXT_POLICY_PUBLICATION_RECEIPT_INVALID');
    const publicationCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_authorization_policy_publications');
    for (const [suffix, receiptOverrides] of [
      ['command', { commandType: 'other.command' }],
      ['target-kind', { targetKind: 'other_target' }],
      ['target-id', { targetId: 'other-target' }],
      ['outcome', { outcome: 'rejected' }],
      ['expected-version', { expectedRowVersion: 0 }],
      ['committed-version', { committedTargetRowVersion: 4 }],
      ['missing-result-key', { canonicalResultJson: JSON.stringify({ authorityId: 'authority-policy-2', code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: 'f'.repeat(64), policyRevision: 3, publicationId: 'policy-publication-missing-result-key' }) }],
      ['extra-result-key', { canonicalResultJson: JSON.stringify({ authorityId: 'authority-policy-2', code: 'POLICY_PUBLISHED', policyContractVersion: 1, policyManifestSha256: 'f'.repeat(64), policyRevision: 3, publicationId: 'policy-publication-extra-result-key', status: 'accepted', extra: true }) }],
      ['boolean-result-version', { canonicalResultJson: JSON.stringify({ authorityId: 'authority-policy-2', code: 'POLICY_PUBLISHED', policyContractVersion: true, policyManifestSha256: 'f'.repeat(64), policyRevision: 3, publicationId: 'policy-publication-boolean-result-version', status: 'accepted' }) }],
      ['string-result-version', { canonicalResultJson: JSON.stringify({ authorityId: 'authority-policy-2', code: 'POLICY_PUBLISHED', policyContractVersion: '1', policyManifestSha256: 'f'.repeat(64), policyRevision: 3, publicationId: 'policy-publication-string-result-version', status: 'accepted' }) }],
      ['fractional-result-version', { canonicalResultJson: '{"authorityId":"authority-policy-2","code":"POLICY_PUBLISHED","policyContractVersion":1,"policyManifestSha256":"' + 'f'.repeat(64) + '","policyRevision":3.0,"publicationId":"policy-publication-fractional-result-version","status":"accepted"}' }],
    ]) {
      const publicationId = `policy-publication-${suffix}`;
      await insertPolicyReceipt({ receiptId: `policy-receipt-${suffix}`, idempotencyKey: `policy-key-${suffix}`, publicationId, policyRevision: 3, policyManifestSha256: 'f'.repeat(64), ...receiptOverrides });
      await assert.rejects(() => insertPublication({ publicationId, authorityId: 'authority-policy-2', receiptId: `policy-receipt-${suffix}`, policyRevision: 3, policyManifestSha256: 'f'.repeat(64) }), error => error && error.code === 'P0001' && error.message === 'VNEXT_POLICY_PUBLICATION_RECEIPT_INVALID');
      assert.deepStrictEqual(await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_authorization_policy_publications'), publicationCount);
    }
    await insertPolicyReceipt({ receiptId: 'policy-receipt-gap', idempotencyKey: 'policy-key-gap', publicationId: 'policy-publication-gap', policyRevision: 4, policyManifestSha256: 'f'.repeat(64) });
    await assert.rejects(() => insertPublication({ publicationId: 'policy-publication-gap', authorityId: 'authority-policy-2', receiptId: 'policy-receipt-gap', policyRevision: 4, policyManifestSha256: 'f'.repeat(64) }), error => error && error.code === 'P0001' && error.message === 'VNEXT_POLICY_REVISION_CONFLICT');
    await facade.query("INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ('authority-policy-inactive', 'disabled', $1, $1)", [FOUNDATION_INSTANT]);
    await insertPolicyReceipt({ receiptId: 'policy-receipt-inactive', idempotencyKey: 'policy-key-inactive', publicationId: 'policy-publication-inactive', authorityId: 'authority-policy-inactive', policyRevision: 1, policyManifestSha256: 'f'.repeat(64) });
    await assert.rejects(() => insertPublication({ publicationId: 'policy-publication-inactive', authorityId: 'authority-policy-inactive', receiptId: 'policy-receipt-inactive', policyRevision: 1, policyManifestSha256: 'f'.repeat(64) }), error => error && error.code === 'P0001' && error.message === 'VNEXT_POLICY_PUBLICATION_RECEIPT_INVALID');
    await facade.query("INSERT INTO vnext_control_plane.vnext_authorities (authority_id, status, created_at, updated_at) VALUES ('authority-policy-bootstrap-orphan', 'active', $1, $1)", [FOUNDATION_INSTANT]);
    const orphanHash = 'f'.repeat(64);
    const orphanResult = JSON.stringify({ authorityId: 'authority-policy-bootstrap-orphan', code: 'AUTHORITY_BOOTSTRAPPED', policyContractVersion: 1, policyManifestSha256: orphanHash, policyRevision: 1, publicationId: 'policy-publication-bootstrap-orphan', status: 'accepted' });
    await insertPolicyReceipt({ receiptId: 'policy-receipt-bootstrap-orphan', idempotencyKey: 'policy-key-bootstrap-orphan', publicationId: 'policy-publication-bootstrap-orphan', authorityId: 'authority-policy-bootstrap-orphan', actorKey: 'bootstrap:orphan-intent', commandType: 'authority.bootstrap', targetKind: 'authority', resultCode: 'AUTHORITY_BOOTSTRAPPED', policyRevision: 1, policyManifestSha256: orphanHash, canonicalResultJson: orphanResult });
    await assert.rejects(() => insertPublication({ publicationId: 'policy-publication-bootstrap-orphan', authorityId: 'authority-policy-bootstrap-orphan', receiptId: 'policy-receipt-bootstrap-orphan', policyRevision: 1, policyManifestSha256: orphanHash }), error => error && error.code === 'P0001' && error.message === 'VNEXT_POLICY_PUBLICATION_RECEIPT_INVALID');
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_authorization_policy_publications (publication_id, authority_id, receipt_id, policy_revision, policy_contract_version, canonical_manifest_json, policy_manifest_sha256, published_at) VALUES ('verifier-policy', 'authority-1', 'bootstrap-receipt-1', 2, 1, '{}', repeat('a', 64), $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_authorization_policy_publications')));
}

async function assertTrustRootEvidenceSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const recoveryResult = JSON.stringify({
      authorityId: 'authority-1',
      code: 'OWNER_RECOVERY_COMPLETED',
      replacementAccountId: 'replacement-account-1',
      status: 'accepted',
    });
    const insertReceipt = ({
      receiptId,
      actorKey = 'recovery:recovery-event-1',
      commandType = 'authority.owner_recover',
      targetKind = 'authority',
      targetId = 'authority-1',
      outcome = 'accepted',
      resultCode = 'OWNER_RECOVERY_COMPLETED',
      resultJson = recoveryResult,
      createdAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_authorization_command_receipts (receipt_id, authority_id, actor_key, actor_account_id, idempotency_key, command_type, target_kind, target_id, canonical_request_sha256, expected_row_version, outcome, result_code, canonical_result_json, canonical_result_sha256, committed_auth_version, committed_access_version, committed_revocation_version, committed_target_row_version, created_at) VALUES ($1, \'authority-1\', $2, NULL, $3, $4, $5, $6, repeat(\'a\', 64), NULL, $7, $8, $9, repeat(\'b\', 64), NULL, NULL, NULL, NULL, $10)',
      [receiptId, actorKey, `recovery-key-${receiptId}`, commandType, targetKind, targetId, outcome, resultCode, resultJson, createdAt],
    );
    const insertEvidence = ({
      evidenceId,
      authorityId = 'authority-1',
      receiptId,
      actorKind,
      eventId,
      assertionHash = 'c'.repeat(64),
      backupId = null,
      backupHash = null,
      createdAt = FOUNDATION_INSTANT,
    }) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_trust_root_evidence (evidence_id, authority_id, receipt_id, actor_kind, event_id, assertion_evidence_sha256, backup_id, backup_manifest_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [evidenceId, authorityId, receiptId, actorKind, eventId, assertionHash, backupId, backupHash, createdAt],
    );

    await insertReceipt({ receiptId: 'recovery-receipt-1' });
    await assert.rejects(() => insertEvidence({ evidenceId: 'bootstrap-with-backup', receiptId: 'bootstrap-receipt-1', actorKind: 'deployment_bootstrap', eventId: 'bootstrap-intent-1', backupId: 'backup-3', backupHash: 'd'.repeat(64) }), error => error && error.constraint === 'vnext_trust_root_evidence_check');
    await insertEvidence({ evidenceId: 'bootstrap-evidence-1', receiptId: 'bootstrap-receipt-1', actorKind: 'deployment_bootstrap', eventId: 'bootstrap-intent-1' });

    await assert.rejects(() => insertEvidence({ evidenceId: 'bootstrap-before-marker', receiptId: 'bootstrap-receipt-1', actorKind: 'deployment_bootstrap', eventId: 'bootstrap-intent-1', createdAt: '2026-08-14T23:59:59.999Z' }), error => error && error.code === 'P0001' && error.message === 'VNEXT_TRUST_ROOT_EVIDENCE_RECEIPT_INVALID');
    await insertReceipt({ receiptId: 'recovery-bad-command', commandType: 'other.command' });
    await assert.rejects(() => insertEvidence({ evidenceId: 'recovery-bad-command-evidence', receiptId: 'recovery-bad-command', actorKind: 'owner_recovery_event', eventId: 'recovery-event-bad-command', backupId: 'backup-2', backupHash: 'd'.repeat(64) }), error => error && error.code === 'P0001' && error.message === 'VNEXT_TRUST_ROOT_EVIDENCE_RECEIPT_INVALID');
    await assert.rejects(() => insertEvidence({ evidenceId: 'recovery-missing-backup', receiptId: 'recovery-receipt-1', actorKind: 'owner_recovery_event', eventId: 'recovery-event-1' }), error => error && error.constraint === 'vnext_trust_root_evidence_check');
    await assert.rejects(() => insertEvidence({ evidenceId: 'recovery-upper-hash', receiptId: 'recovery-receipt-1', actorKind: 'owner_recovery_event', eventId: 'recovery-event-1', backupId: 'backup-4', backupHash: 'D'.repeat(64) }), error => error && error.constraint === 'vnext_trust_root_evidence_backup_manifest_sha256_check');
    await insertEvidence({ evidenceId: 'recovery-evidence-1', receiptId: 'recovery-receipt-1', actorKind: 'owner_recovery_event', eventId: 'recovery-event-1', backupId: 'backup-1', backupHash: 'd'.repeat(64) });
    assert.deepStrictEqual((await facade.query('SELECT evidence_id, actor_kind, event_id FROM vnext_control_plane.vnext_trust_root_evidence ORDER BY evidence_id')).rows, [
      { evidence_id: 'bootstrap-evidence-1', actor_kind: 'deployment_bootstrap', event_id: 'bootstrap-intent-1' },
      { evidence_id: 'recovery-evidence-1', actor_kind: 'owner_recovery_event', event_id: 'recovery-event-1' },
    ]);
    const before = await facade.query("SELECT * FROM vnext_control_plane.vnext_trust_root_evidence WHERE evidence_id = 'recovery-evidence-1'");
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_trust_root_evidence SET event_id = 'changed' WHERE evidence_id = 'recovery-evidence-1'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query("DELETE FROM vnext_control_plane.vnext_trust_root_evidence WHERE evidence_id = 'recovery-evidence-1'"), error => error && error.code === 'P0001');
    assert.deepStrictEqual((await facade.query("SELECT * FROM vnext_control_plane.vnext_trust_root_evidence WHERE evidence_id = 'recovery-evidence-1'")).rows, before.rows);
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_trust_root_evidence (evidence_id, authority_id, receipt_id, actor_kind, event_id, assertion_evidence_sha256, backup_id, backup_manifest_sha256, created_at) VALUES ('verifier-evidence', 'authority-1', 'bootstrap-receipt-1', 'deployment_bootstrap', 'bootstrap-intent-1', repeat('c', 64), NULL, NULL, $1)", [FOUNDATION_INSTANT])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_trust_root_evidence')));
}

async function assertSessionsAndReauthenticationSemantics(handle) {
  await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
    const issuedAt = '2026-08-15T01:00:00.000Z';
    const expiresAt = '2026-08-15T02:00:00.000Z';
    const updatedAt = '2026-08-15T01:00:01.000Z';
    const sessionValues = ({ sessionId, sessionKind = 'online', status = 'active', rowVersion = 1, revokedAt = null, updated = issuedAt, versions = [1, 1, 1, 1, 1, 1, 1, 1, 1] } = {}) => [
      sessionId, 'authority-1', 'account-1', 'device-1', 'installation-1', 'link-1', sessionKind, status, issuedAt, expiresAt, revokedAt,
      ...versions, rowVersion, issuedAt, updated,
    ];
    const insertSession = values => facade.query(
      'INSERT INTO vnext_control_plane.vnext_sessions (session_id, authority_id, account_id, device_id, installation_id, link_id, session_kind, status, issued_at, expires_at, revoked_at, account_auth_version, account_access_version, account_revocation_version, device_credential_version, device_risk_version, installation_credential_version, link_auth_version, link_access_version, link_row_version, row_version, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)',
      values,
    );
    const insertReauth = ({ eventId, sessionId, factorClass = 'password', verifiedAt = '2026-08-15T01:10:00.000Z', reauthExpiresAt = '2026-08-15T01:20:00.000Z', versions = [1, 1, 1, 1, 1, 1, 1, 1, 1] } = {}) => facade.query(
      'INSERT INTO vnext_control_plane.vnext_recent_reauthentication_events (reauth_event_id, authority_id, session_id, factor_class, evidence_sha256, account_auth_version, account_access_version, account_revocation_version, device_credential_version, device_risk_version, installation_credential_version, link_auth_version, link_access_version, link_row_version, verified_at, expires_at, created_at) VALUES ($1,\'authority-1\',$2,$3,repeat(\'a\',64),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13)',
      [eventId, sessionId, factorClass, ...versions, verifiedAt, reauthExpiresAt],
    );

    await insertSession(sessionValues({ sessionId: 'session-online-1' }));
    await insertReauth({ eventId: 'reauth-valid-1', sessionId: 'session-online-1', factorClass: 'passkey' });
    await insertReauth({ eventId: 'reauth-valid-password', sessionId: 'session-online-1', factorClass: 'password' });
    await insertReauth({ eventId: 'reauth-valid-contact', sessionId: 'session-online-1', factorClass: 'verified_contact' });
    for (let index = 0; index < 9; index += 1) {
      const versions = [1, 1, 1, 1, 1, 1, 1, 1, 1];
      versions[index] = 2;
      await assert.rejects(() => insertReauth({ eventId: `reauth-vector-${index}`, sessionId: 'session-online-1', versions }), error => error && error.code === 'P0001' && error.message === 'VNEXT_REAUTH_SESSION_STATE_INVALID');
    }
    await assert.rejects(() => insertReauth({ eventId: 'reauth-invalid-factor', sessionId: 'session-online-1', factorClass: 'otp' }), error => error && error.constraint === 'vnext_recent_reauthentication_events_factor_class_check');
    await assert.rejects(() => insertReauth({ eventId: 'reauth-window-invalid', sessionId: 'session-online-1', verifiedAt: expiresAt }), error => error && error.code === 'P0001' && error.message === 'VNEXT_REAUTH_SESSION_STATE_INVALID');
    await assert.rejects(() => insertReauth({ eventId: 'reauth-equal-window', sessionId: 'session-online-1', reauthExpiresAt: '2026-08-15T01:10:00.000Z' }), error => error && error.constraint === 'vnext_recent_reauthentication_events_check');
    await assert.rejects(() => insertReauth({ eventId: 'reauth-before-session', sessionId: 'session-online-1', verifiedAt: '2026-08-15T00:59:59.999Z' }), error => error && error.code === 'P0001' && error.message === 'VNEXT_REAUTH_SESSION_STATE_INVALID');
    await assert.rejects(() => insertSession(sessionValues({ sessionId: ' ', })), error => error && error.constraint === 'vnext_sessions_session_id_check');
    await assert.rejects(() => insertSession(sessionValues({ sessionId: 'session-bad-kind', sessionKind: 'offline' })), error => error && error.constraint === 'vnext_sessions_session_kind_check');
    const equalWindow = sessionValues({ sessionId: 'session-equal-window' }); equalWindow[9] = issuedAt;
    await assert.rejects(() => insertSession(equalWindow), error => error && error.constraint === 'vnext_sessions_check');
    const revokedWithoutTimestamp = sessionValues({ sessionId: 'session-revoked-without-time', status: 'revoked' });
    await assert.rejects(() => insertSession(revokedWithoutTimestamp), error => error && error.constraint === 'vnext_sessions_check3');
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_sessions SET session_kind='initialization' WHERE session_id='session-online-1'"), error => error && error.code === 'P0001');
    const onlineBefore = await facade.query("SELECT * FROM vnext_control_plane.vnext_sessions WHERE session_id='session-online-1'");
    await facade.query("UPDATE vnext_control_plane.vnext_sessions SET status='revoked', revoked_at=$1, row_version=2, updated_at=$1 WHERE session_id='session-online-1'", [updatedAt]);
    await assert.rejects(() => insertReauth({ eventId: 'reauth-revoked-session', sessionId: 'session-online-1' }), error => error && error.code === 'P0001' && error.message === 'VNEXT_REAUTH_SESSION_STATE_INVALID');
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_sessions SET updated_at='2026-08-15T01:00:02.000Z' WHERE session_id='session-online-1'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query("DELETE FROM vnext_control_plane.vnext_sessions WHERE session_id='session-online-1'"), error => error && error.code === 'P0001');
    assert.strictEqual((await facade.query("SELECT status, row_version::text AS row_version FROM vnext_control_plane.vnext_sessions WHERE session_id='session-online-1'")).rows[0].status, 'revoked');
    assert.strictEqual(onlineBefore.rows[0].status, 'active');

    await insertSession(sessionValues({ sessionId: 'session-expired-1' }));
    await facade.query("UPDATE vnext_control_plane.vnext_sessions SET status='expired', row_version=2, updated_at=$1 WHERE session_id='session-expired-1'", [updatedAt]);
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_sessions SET status='revoked', revoked_at=$1, row_version=3, updated_at=$1 WHERE session_id='session-expired-1'", ['2026-08-15T01:00:02.000Z']), error => error && error.code === 'P0001');

    await insertSession(sessionValues({ sessionId: 'session-initialization-1', sessionKind: 'initialization' }));
    await assert.rejects(() => insertReauth({ eventId: 'reauth-initialization', sessionId: 'session-initialization-1' }), error => error && error.code === 'P0001' && error.message === 'VNEXT_REAUTH_ONLINE_SESSION_REQUIRED');
    await insertSession(sessionValues({ sessionId: 'session-parent-vector-1' }));
    await facade.query("UPDATE vnext_control_plane.vnext_accounts SET access_version=2, updated_at='2026-08-15T01:00:02.000Z' WHERE account_id='account-1' AND authority_id='authority-1'");
    await assert.rejects(() => insertReauth({ eventId: 'reauth-stale-parent', sessionId: 'session-parent-vector-1' }), error => error && error.code === 'P0001' && error.message === 'VNEXT_REAUTH_CURRENT_PARENT_INVALID');
    await assert.rejects(() => insertSession(sessionValues({ sessionId: 'session-stale-parent-1' })), error => error && error.code === 'P0001' && error.message === 'VNEXT_SESSION_PARENT_STATE_INVALID');
    const currentVersions = [1, 2, 1, 1, 1, 1, 1, 1, 1];
    await insertSession(sessionValues({ sessionId: 'session-parent-states-1', versions: currentVersions }));
    const parentStates = [
      ["UPDATE vnext_control_plane.vnext_authorities SET status='disabled' WHERE authority_id='authority-1'", "UPDATE vnext_control_plane.vnext_authorities SET status='active' WHERE authority_id='authority-1'"],
      ["UPDATE vnext_control_plane.vnext_accounts SET status='disabled' WHERE authority_id='authority-1' AND account_id='account-1'", "UPDATE vnext_control_plane.vnext_accounts SET status='active' WHERE authority_id='authority-1' AND account_id='account-1'"],
      ["UPDATE vnext_control_plane.vnext_trusted_devices SET status='risk_limited' WHERE authority_id='authority-1' AND device_id='device-1'", "UPDATE vnext_control_plane.vnext_trusted_devices SET status='active' WHERE authority_id='authority-1' AND device_id='device-1'"],
      ["UPDATE vnext_control_plane.vnext_device_installations SET status='retired' WHERE authority_id='authority-1' AND installation_id='installation-1'", "UPDATE vnext_control_plane.vnext_device_installations SET status='active' WHERE authority_id='authority-1' AND installation_id='installation-1'"],
      ["UPDATE vnext_control_plane.vnext_account_device_links SET status='expired' WHERE authority_id='authority-1' AND link_id='link-1'", "UPDATE vnext_control_plane.vnext_account_device_links SET status='active' WHERE authority_id='authority-1' AND link_id='link-1'"],
    ];
    for (let index = 0; index < parentStates.length; index += 1) {
      await facade.query(parentStates[index][0]);
      await assert.rejects(() => insertReauth({ eventId: `reauth-parent-state-${index}`, sessionId: 'session-parent-states-1', versions: currentVersions }), error => error && error.code === 'P0001' && error.message === 'VNEXT_REAUTH_CURRENT_PARENT_INVALID');
      await facade.query(parentStates[index][1]);
    }
    await assert.rejects(() => facade.query("UPDATE vnext_control_plane.vnext_recent_reauthentication_events SET factor_class='password' WHERE reauth_event_id='reauth-valid-1'"), error => error && error.code === 'P0001');
    await assert.rejects(() => facade.query("DELETE FROM vnext_control_plane.vnext_recent_reauthentication_events WHERE reauth_event_id='reauth-valid-1'"), error => error && error.code === 'P0001');
  });
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query("INSERT INTO vnext_control_plane.vnext_sessions (session_id, authority_id, account_id, device_id, installation_id, link_id, session_kind, status, issued_at, expires_at, revoked_at, account_auth_version, account_access_version, account_revocation_version, device_credential_version, device_risk_version, installation_credential_version, link_auth_version, link_access_version, link_row_version, row_version, created_at, updated_at) VALUES ('verifier-session','authority-1','account-1','device-1','installation-1','link-1','online','active',$1,$2,NULL,1,1,1,1,1,1,1,1,1,1,$1,$1)", [FOUNDATION_INSTANT, '2026-08-15T03:00:00.000Z'])));
  await assert.rejects(() => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query('SELECT * FROM vnext_control_plane.vnext_sessions')));
}

async function runCatalogAssertionCases(runtime) {
  const catalog = createVNextPg17CatalogBoundary(runtime);
  let priorHandle;
  const createHandle = async () => {
    if (priorHandle) {
      await runtime.disposeHandle(priorHandle);
    }
    priorHandle = await runtime.createIsolatedHandle();
    return priorHandle;
  };
  try {
    await assert.rejects(
      () => catalog.assert({}),
      error => error && error.code === 'VNEXT_PG17_HANDLE_INVALID',
    );
    const migrationInput = {
      appliedAt: '2026-08-14T00:00:00.000Z',
      appliedBy: 'pg17-test',
    };
    const preexistingShadowHandle = await createHandle();
    await withVNextPg17SyntheticQuery(preexistingShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_schema_migrations (id integer)',
    ));
    await assert.rejects(
      () => catalog.apply(preexistingShadowHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(preexistingShadowHandle, 'fixture-provisioner', async facade => {
      const target = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_schema_migrations') AS relation");
      assert.strictEqual(target.rows[0].relation, null);
    });
    const legacyLedgerHandle = await createHandle();
    await withVNextPg17SyntheticQuery(legacyLedgerHandle, 'fixture-provisioner', async facade => {
      await facade.query(FIRST_MIGRATION.sql);
      await facade.query(
        'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
        [FIRST_MIGRATION.migrationId, FIRST_MIGRATION.semanticVersion, FIRST_MIGRATION.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy],
      );
    });
    await assert.rejects(
      () => catalog.apply(legacyLedgerHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    const foundationPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(foundationPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) {
          await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        }
        await facade.query(
          'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
          [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy],
        );
      }
    });
    await assert.rejects(
      () => catalog.apply(foundationPrefixHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await assert.rejects(
      () => catalog.assert(foundationPrefixHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    const roleGrantPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(roleGrantPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) {
          await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        }
        await facade.query(
          'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
          [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy],
        );
      }
    });
    await assert.rejects(
      () => catalog.apply(roleGrantPrefixHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(roleGrantPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query(
        'SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version::bigint',
      );
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }]);
      const capabilityRelation = await facade.query(
        "SELECT to_regclass('vnext_control_plane.vnext_capability_catalog') AS relation",
      );
      assert.strictEqual(capabilityRelation.rows[0].relation, null);
    });
    await assert.rejects(
      () => catalog.assert(roleGrantPrefixHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    const capabilityCatalogPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(capabilityCatalogPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) {
          await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        }
        await facade.query(
          'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
          [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy],
        );
      }
    });
    await assert.rejects(
      () => catalog.apply(capabilityCatalogPrefixHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(capabilityCatalogPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query(
        'SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
      );
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }]);
      const overrideRelation = await facade.query(
        "SELECT to_regclass('vnext_control_plane.vnext_capability_overrides') AS relation",
      );
      assert.strictEqual(overrideRelation.rows[0].relation, null);
    });
    await assert.rejects(
      () => catalog.assert(capabilityCatalogPrefixHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    const dataScopePrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(dataScopePrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION, CAPABILITY_OVERRIDES_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) {
          await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        }
        await facade.query(
          'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
          [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy],
        );
      }
    });
    await assert.rejects(
      () => catalog.apply(dataScopePrefixHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(dataScopePrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query(
        'SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
      );
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }]);
      const scopeRelation = await facade.query(
        "SELECT to_regclass('vnext_control_plane.vnext_data_scope_grants') AS relation",
      );
      assert.strictEqual(scopeRelation.rows[0].relation, null);
    });
    await assert.rejects(
      () => catalog.assert(dataScopePrefixHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    const receiptPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(receiptPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION, CAPABILITY_OVERRIDES_MIGRATION, DATA_SCOPE_GRANTS_MIGRATION, PROFILE_BINDINGS_MIGRATION, VERIFIED_CONTACTS_MIGRATION, AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) {
          await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        }
        await facade.query(
          'INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)',
          [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy],
        );
      }
    });
    await assert.rejects(() => catalog.apply(receiptPrefixHandle, migrationInput), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    await withVNextPg17SyntheticQuery(receiptPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query('SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version');
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }, { semantic_version: '6' }, { semantic_version: '7' }, { semantic_version: '8' }, { semantic_version: '9' }]);
      const relation = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_authorization_audit_events') AS relation, to_regprocedure('vnext_control_plane.vnext_authorization_audit_events_no_update()') AS update_function, to_regprocedure('vnext_control_plane.vnext_authorization_audit_events_no_delete()') AS delete_function");
      assert.strictEqual(relation.rows[0].relation, null);
      assert.strictEqual(relation.rows[0].update_function, null);
      assert.strictEqual(relation.rows[0].delete_function, null);
    });
    await assert.rejects(() => catalog.assert(receiptPrefixHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    const auditPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(auditPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION, CAPABILITY_OVERRIDES_MIGRATION, DATA_SCOPE_GRANTS_MIGRATION, PROFILE_BINDINGS_MIGRATION, VERIFIED_CONTACTS_MIGRATION, AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION, AUTHORIZATION_AUDIT_EVENTS_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        await facade.query('INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)', [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy]);
      }
    });
    await assert.rejects(() => catalog.apply(auditPrefixHandle, migrationInput), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    await withVNextPg17SyntheticQuery(auditPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query('SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version::bigint');
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }, { semantic_version: '6' }, { semantic_version: '7' }, { semantic_version: '8' }, { semantic_version: '9' }, { semantic_version: '10' }]);
      const absent = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_authorization_outbox_events') AS relation, to_regprocedure('vnext_control_plane.vnext_authorization_outbox_events_no_update()') AS update_function, to_regprocedure('vnext_control_plane.vnext_authorization_outbox_events_no_delete()') AS delete_function");
      assert.deepStrictEqual(absent.rows, [{ relation: null, update_function: null, delete_function: null }]);
    });
    await assert.rejects(() => catalog.assert(auditPrefixHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    const outboxPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(outboxPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION, CAPABILITY_OVERRIDES_MIGRATION, DATA_SCOPE_GRANTS_MIGRATION, PROFILE_BINDINGS_MIGRATION, VERIFIED_CONTACTS_MIGRATION, AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION, AUTHORIZATION_AUDIT_EVENTS_MIGRATION, AUTHORIZATION_OUTBOX_EVENTS_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        await facade.query('INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)', [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy]);
      }
    });
    await assert.rejects(() => catalog.apply(outboxPrefixHandle, migrationInput), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    await withVNextPg17SyntheticQuery(outboxPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query('SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version::bigint');
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }, { semantic_version: '6' }, { semantic_version: '7' }, { semantic_version: '8' }, { semantic_version: '9' }, { semantic_version: '10' }, { semantic_version: '11' }]);
      const absent = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_bootstrap_consumptions') AS relation, to_regprocedure('vnext_control_plane.vnext_bootstrap_consumptions_insert_guard()') AS insert_function, to_regprocedure('vnext_control_plane.vnext_bootstrap_consumptions_no_update()') AS update_function, to_regprocedure('vnext_control_plane.vnext_bootstrap_consumptions_no_delete()') AS delete_function");
      assert.deepStrictEqual(absent.rows, [{ relation: null, insert_function: null, update_function: null, delete_function: null }]);
    });
    await assert.rejects(() => catalog.assert(outboxPrefixHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    const bootstrapPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(bootstrapPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION, CAPABILITY_OVERRIDES_MIGRATION, DATA_SCOPE_GRANTS_MIGRATION, PROFILE_BINDINGS_MIGRATION, VERIFIED_CONTACTS_MIGRATION, AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION, AUTHORIZATION_AUDIT_EVENTS_MIGRATION, AUTHORIZATION_OUTBOX_EVENTS_MIGRATION, BOOTSTRAP_CONSUMPTIONS_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        await facade.query('INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)', [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy]);
      }
    });
    await assert.rejects(() => catalog.apply(bootstrapPrefixHandle, migrationInput), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    await withVNextPg17SyntheticQuery(bootstrapPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query('SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version::bigint');
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }, { semantic_version: '6' }, { semantic_version: '7' }, { semantic_version: '8' }, { semantic_version: '9' }, { semantic_version: '10' }, { semantic_version: '11' }, { semantic_version: '12' }]);
      const absent = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_authorization_policy_publications') AS relation, to_regprocedure('vnext_control_plane.vnext_authorization_policy_publications_insert_guard()') AS insert_function, to_regprocedure('vnext_control_plane.vnext_authorization_policy_publications_no_update()') AS update_function, to_regprocedure('vnext_control_plane.vnext_authorization_policy_publications_no_delete()') AS delete_function");
      assert.deepStrictEqual(absent.rows, [{ relation: null, insert_function: null, update_function: null, delete_function: null }]);
    });
    await assert.rejects(() => catalog.assert(bootstrapPrefixHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    const policyPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(policyPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION, CAPABILITY_OVERRIDES_MIGRATION, DATA_SCOPE_GRANTS_MIGRATION, PROFILE_BINDINGS_MIGRATION, VERIFIED_CONTACTS_MIGRATION, AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION, AUTHORIZATION_AUDIT_EVENTS_MIGRATION, AUTHORIZATION_OUTBOX_EVENTS_MIGRATION, BOOTSTRAP_CONSUMPTIONS_MIGRATION, AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        await facade.query('INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)', [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy]);
      }
    });
    await assert.rejects(() => catalog.apply(policyPrefixHandle, migrationInput), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    await withVNextPg17SyntheticQuery(policyPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query('SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version::bigint');
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }, { semantic_version: '6' }, { semantic_version: '7' }, { semantic_version: '8' }, { semantic_version: '9' }, { semantic_version: '10' }, { semantic_version: '11' }, { semantic_version: '12' }, { semantic_version: '13' }]);
      const absent = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_trust_root_evidence') AS relation, to_regprocedure('vnext_control_plane.vnext_trust_root_evidence_insert_guard()') AS insert_function, to_regprocedure('vnext_control_plane.vnext_trust_root_evidence_no_update()') AS update_function, to_regprocedure('vnext_control_plane.vnext_trust_root_evidence_no_delete()') AS delete_function");
      assert.deepStrictEqual(absent.rows, [{ relation: null, insert_function: null, update_function: null, delete_function: null }]);
    });
    await assert.rejects(() => catalog.assert(policyPrefixHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    const sessionsPrefixHandle = await createHandle();
    await withVNextPg17SyntheticQuery(sessionsPrefixHandle, 'fixture-provisioner', async facade => {
      for (const migration of [FIRST_MIGRATION, FOUNDATION_IDENTITY_DEVICE_MIGRATION, ROLE_GRANTS_MIGRATION, CAPABILITY_CATALOG_MIGRATION, CAPABILITY_OVERRIDES_MIGRATION, DATA_SCOPE_GRANTS_MIGRATION, PROFILE_BINDINGS_MIGRATION, VERIFIED_CONTACTS_MIGRATION, AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION, AUTHORIZATION_AUDIT_EVENTS_MIGRATION, AUTHORIZATION_OUTBOX_EVENTS_MIGRATION, BOOTSTRAP_CONSUMPTIONS_MIGRATION, AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION, TRUST_ROOT_EVIDENCE_MIGRATION]) {
        await facade.query(migration.sql);
        if (migration.postApply) await facade.query(migration.postApply.text, migration.postApply.values(migrationInput.appliedAt));
        await facade.query('INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ($1, $2, $3, $4, $5)', [migration.migrationId, migration.semanticVersion, migration.manifestSha256, migrationInput.appliedAt, migrationInput.appliedBy]);
      }
    });
    await assert.rejects(() => catalog.apply(sessionsPrefixHandle, migrationInput), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    await withVNextPg17SyntheticQuery(sessionsPrefixHandle, 'fixture-provisioner', async facade => {
      const ledgerRows = await facade.query('SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version::bigint');
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }, { semantic_version: '6' }, { semantic_version: '7' }, { semantic_version: '8' }, { semantic_version: '9' }, { semantic_version: '10' }, { semantic_version: '11' }, { semantic_version: '12' }, { semantic_version: '13' }, { semantic_version: '14' }]);
      const absent = await facade.query("SELECT to_regclass('vnext_control_plane.vnext_sessions') AS sessions, to_regclass('vnext_control_plane.vnext_recent_reauthentication_events') AS reauth, to_regprocedure('vnext_control_plane.vnext_sessions_parent_state_match()') AS session_guard, to_regprocedure('vnext_control_plane.vnext_recent_reauthentication_events_session_state_match()') AS reauth_guard");
      assert.deepStrictEqual(absent.rows, [{ sessions: null, reauth: null, session_guard: null, reauth_guard: null }]);
    });
    await assert.rejects(() => catalog.assert(sessionsPrefixHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    const handle = await createHandle();
    await assert.rejects(
      () => catalog.assert(handle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await catalog.apply(handle, migrationInput);
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      const ledgerRows = await facade.query(
        'SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version::bigint',
      );
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }, { semantic_version: '5' }, { semantic_version: '6' }, { semantic_version: '7' }, { semantic_version: '8' }, { semantic_version: '9' }, { semantic_version: '10' }, { semantic_version: '11' }, { semantic_version: '12' }, { semantic_version: '13' }, { semantic_version: '14' }, { semantic_version: '15' }, { semantic_version: '16' }]);
      const schemaMetaRows = await facade.query(
        'SELECT schema_key, schema_version::text AS schema_version FROM vnext_control_plane.vnext_schema_meta',
      );
      assert.deepStrictEqual(schemaMetaRows.rows, [{ schema_key: 'control-plane-reference', schema_version: '5' }]);
      const roleGrantCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_role_grants');
      assert.deepStrictEqual(roleGrantCount.rows, [{ count: '0' }]);
      const capabilityCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_capability_catalog');
      assert.deepStrictEqual(capabilityCount.rows, [{ count: '0' }]);
      const overrideCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_capability_overrides');
      assert.deepStrictEqual(overrideCount.rows, [{ count: '0' }]);
      const scopeGrantCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_data_scope_grants');
      assert.deepStrictEqual(scopeGrantCount.rows, [{ count: '0' }]);
    const profileBindingCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_profile_bindings');
    assert.deepStrictEqual(profileBindingCount.rows, [{ count: '0' }]);
    const verifiedContactCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_verified_contacts');
    assert.deepStrictEqual(verifiedContactCount.rows, [{ count: '0' }]);
    const receiptCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_authorization_command_receipts');
    assert.deepStrictEqual(receiptCount.rows, [{ count: '0' }]);
    const auditCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_authorization_audit_events');
    assert.deepStrictEqual(auditCount.rows, [{ count: '0' }]);
    const outboxCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_authorization_outbox_events');
    assert.deepStrictEqual(outboxCount.rows, [{ count: '0' }]);
    const bootstrapConsumptionCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_bootstrap_consumptions');
    assert.deepStrictEqual(bootstrapConsumptionCount.rows, [{ count: '0' }]);
    const policyPublicationCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_authorization_policy_publications');
    assert.deepStrictEqual(policyPublicationCount.rows, [{ count: '0' }]);
    const sessionCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_sessions');
    assert.deepStrictEqual(sessionCount.rows, [{ count: '0' }]);
    const reauthenticationCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_recent_reauthentication_events');
    assert.deepStrictEqual(reauthenticationCount.rows, [{ count: '0' }]);
    });
    await assert.doesNotReject(() => catalog.assert(handle));
    await assertFoundationSemantics(handle);
    await assertSessionsAndReauthenticationSemantics(handle);
    await assertRoleGrantSemantics(handle);
    await assertCapabilityCatalogSemantics(handle);
    await assertCapabilityOverrideSemantics(handle);
    await assertDataScopeGrantSemantics(handle);
    await assertProfileBindingSemantics(handle);
    await assertVerifiedContactSemantics(handle);
    await assertAuthorizationCommandReceiptSemantics(handle);
    await assertAuthorizationAuditEventSemantics(handle);
    await assertAuthorizationOutboxEventSemantics(handle);
    await assertBootstrapConsumptionSemantics(handle);
    await assertAuthorizationPolicyPublicationSemantics(handle);
    await assertTrustRootEvidenceSemantics(handle);
    assert.deepStrictEqual(await catalog.apply(handle, migrationInput), { applied: false });
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      await facade.query('BEGIN READ ONLY');
      try {
        const before = await facade.query('SELECT txid_current_if_assigned() AS transaction_id');
        assert.strictEqual(before.rows[0].transaction_id, null);
        await catalog.assert(handle);
        const after = await facade.query('SELECT txid_current_if_assigned() AS transaction_id');
        assert.strictEqual(after.rows[0].transaction_id, null);
      } finally {
        await facade.query('ROLLBACK');
      }
    });
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
        "INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ('future', 18, repeat('a', 64), now(), 'fixture')",
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
        'DELETE FROM vnext_control_plane.vnext_schema_migrations',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'CREATE TEMPORARY TABLE runtime_should_not_create (id integer)',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'CREATE TABLE public.runtime_should_not_create (id integer)',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'TRUNCATE vnext_control_plane.vnext_schema_migrations',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'runtime', facade => facade.query(
        'ALTER TABLE vnext_control_plane.vnext_schema_migrations DISABLE TRIGGER ALL',
      )),
    );
    await assert.doesNotReject(
      () => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
        'SELECT migration_id FROM vnext_control_plane.vnext_schema_migrations',
      )),
    );
    await assert.rejects(
      () => withVNextPg17SyntheticQuery(handle, 'verifier', facade => facade.query(
        "INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ('verifier-write', 2, repeat('a', 64), now(), 'verifier')",
      )),
    );
    await assert.doesNotReject(() => catalog.assert(handle));
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations ADD COLUMN unexpected_column integer',
    ));
    await assert.rejects(
      () => catalog.assert(handle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const triggerHandle = await createHandle();
    await catalog.apply(triggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(triggerHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations DISABLE TRIGGER vnext_schema_migrations_no_delete',
    ));
    await assert.rejects(
      () => catalog.assert(triggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const aclHandle = await createHandle();
    await catalog.apply(aclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(aclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_schema_migrations TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(aclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const functionHandle = await createHandle();
    await catalog.apply(functionHandle, migrationInput);
    await withVNextPg17SyntheticQuery(functionHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() OWNER TO vnext_pg17_migrator',
    ));
    await assert.rejects(
      () => catalog.assert(functionHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const pathHandle = await createHandle();
    await catalog.apply(pathHandle, migrationInput);
    await withVNextPg17SyntheticQuery(pathHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() SET search_path TO public',
    ));
    await assert.rejects(
      () => catalog.assert(pathHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const ownerHandle = await createHandle();
    await catalog.apply(ownerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(ownerHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations OWNER TO vnext_pg17_migrator',
    ));
    await assert.rejects(
      () => catalog.assert(ownerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const extraRelationHandle = await createHandle();
    await catalog.apply(extraRelationHandle, migrationInput);
    await withVNextPg17SyntheticQuery(extraRelationHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE vnext_control_plane.unapproved_target_relation (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(extraRelationHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const accountForeignKeyHandle = await createHandle();
    await catalog.apply(accountForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(accountForeignKeyHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_accounts DROP CONSTRAINT vnext_accounts_authority_id_fkey',
    ));
    await assert.rejects(
      () => catalog.assert(accountForeignKeyHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const installationUniqueHandle = await createHandle();
    await catalog.apply(installationUniqueHandle, migrationInput);
    await withVNextPg17SyntheticQuery(installationUniqueHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_device_installations DROP CONSTRAINT vnext_device_installations_authority_id_key_fingerprint_key',
    ));
    await assert.rejects(
      () => catalog.assert(installationUniqueHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const foundationAclHandle = await createHandle();
    await catalog.apply(foundationAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(foundationAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_account_device_links TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(foundationAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeFoundationAclHandle = await createHandle();
    await catalog.apply(runtimeFoundationAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(runtimeFoundationAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_accounts TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(runtimeFoundationAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeSchemaUsageHandle = await createHandle();
    await catalog.apply(runtimeSchemaUsageHandle, migrationInput);
    await withVNextPg17SyntheticQuery(runtimeSchemaUsageHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT USAGE ON SCHEMA vnext_control_plane TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(runtimeSchemaUsageHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeTriggerAclHandle = await createHandle();
    await catalog.apply(runtimeTriggerAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(runtimeTriggerAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT TRIGGER ON vnext_control_plane.vnext_accounts TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(runtimeTriggerAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const foundationTriggerHandle = await createHandle();
    await catalog.apply(foundationTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(foundationTriggerHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TRIGGER unapproved_foundation_no_delete BEFORE DELETE ON vnext_control_plane.vnext_authorities FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()',
    ));
    await assert.rejects(
      () => catalog.assert(foundationTriggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const alteredLedgerTriggerHandle = await createHandle();
    await catalog.apply(alteredLedgerTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(alteredLedgerTriggerHandle, 'fixture-provisioner', async facade => {
      await facade.query('DROP TRIGGER vnext_schema_migrations_no_delete ON vnext_control_plane.vnext_schema_migrations');
      await facade.query('CREATE TRIGGER vnext_schema_migrations_no_delete BEFORE UPDATE ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()');
    });
    await assert.rejects(
      () => catalog.assert(alteredLedgerTriggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const foreignSchemaTriggerHandle = await createHandle();
    await catalog.apply(foreignSchemaTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(foreignSchemaTriggerHandle, 'fixture-provisioner', async facade => {
      await facade.query('CREATE FUNCTION public.vnext_schema_migrations_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END; $$');
      await facade.query('DROP TRIGGER vnext_schema_migrations_no_delete ON vnext_control_plane.vnext_schema_migrations');
      await facade.query('CREATE TRIGGER vnext_schema_migrations_no_delete BEFORE DELETE ON vnext_control_plane.vnext_schema_migrations FOR EACH ROW EXECUTE FUNCTION public.vnext_schema_migrations_no_delete()');
    });
    await assert.rejects(
      () => catalog.assert(foreignSchemaTriggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const verifierPublicAclHandle = await createHandle();
    await catalog.apply(verifierPublicAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(verifierPublicAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT CREATE ON SCHEMA public TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(verifierPublicAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const verifierTemporaryAclHandle = await createHandle();
    await catalog.apply(verifierTemporaryAclHandle, migrationInput);
    const verifierTemporaryDatabase = await withVNextPg17SyntheticQuery(verifierTemporaryAclHandle, 'fixture-provisioner', facade => facade.query(
      'SELECT current_database() AS database_name',
    ));
    assert.match(verifierTemporaryDatabase.rows[0].database_name, /^vnextpg17_[a-z0-9]+$/);
    await withVNextPg17SyntheticQuery(verifierTemporaryAclHandle, 'fixture-provisioner', facade => facade.query(
      `GRANT TEMPORARY ON DATABASE "${verifierTemporaryDatabase.rows[0].database_name}" TO vnext_pg17_verifier`,
    ));
    await assert.rejects(
      () => catalog.assert(verifierTemporaryAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const foundationPublicShadowHandle = await createHandle();
    await catalog.apply(foundationPublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(foundationPublicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_accounts (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(foundationPublicShadowHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const foundationIndexHandle = await createHandle();
    await catalog.apply(foundationIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(foundationIndexHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX unapproved_foundation_account_status_index ON vnext_control_plane.vnext_accounts (status)',
    ));
    await assert.rejects(
      () => catalog.assert(foundationIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantIndexHandle = await createHandle();
    await catalog.apply(roleGrantIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantIndexHandle, 'fixture-provisioner', facade => facade.query(
      'DROP INDEX vnext_control_plane.vnext_role_grants_one_active_role',
    ));
    await assert.rejects(
      () => catalog.assert(roleGrantIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantForeignKeyHandle = await createHandle();
    await catalog.apply(roleGrantForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantForeignKeyHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_role_grants DROP CONSTRAINT vnext_role_grants_granted_by_account_id_authority_id_fkey',
    ));
    await assert.rejects(
      () => catalog.assert(roleGrantForeignKeyHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantPredicateHandle = await createHandle();
    await catalog.apply(roleGrantPredicateHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantPredicateHandle, 'fixture-provisioner', async facade => {
      await facade.query('DROP INDEX vnext_control_plane.vnext_role_grants_one_active_role');
      await facade.query('CREATE UNIQUE INDEX vnext_role_grants_one_active_role ON vnext_control_plane.vnext_role_grants(authority_id, account_id, role)');
    });
    await assert.rejects(
      () => catalog.assert(roleGrantPredicateHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantVerifierAclHandle = await createHandle();
    await catalog.apply(roleGrantVerifierAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantVerifierAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_role_grants TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(roleGrantVerifierAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantRuntimeAclHandle = await createHandle();
    await catalog.apply(roleGrantRuntimeAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantRuntimeAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT SELECT ON vnext_control_plane.vnext_role_grants TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(roleGrantRuntimeAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantTriggerHandle = await createHandle();
    await catalog.apply(roleGrantTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantTriggerHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TRIGGER unapproved_role_grant_delete BEFORE DELETE ON vnext_control_plane.vnext_role_grants FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()',
    ));
    await assert.rejects(
      () => catalog.assert(roleGrantTriggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantDefaultHandle = await createHandle();
    await catalog.apply(roleGrantDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantDefaultHandle, 'fixture-provisioner', facade => facade.query(
      "ALTER TABLE vnext_control_plane.vnext_role_grants ALTER COLUMN role SET DEFAULT 'teacher'",
    ));
    await assert.rejects(
      () => catalog.assert(roleGrantDefaultHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleGrantPublicShadowHandle = await createHandle();
    await catalog.apply(roleGrantPublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleGrantPublicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_role_grants (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(roleGrantPublicShadowHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const capabilityVerifierAclHandle = await createHandle();
    await catalog.apply(capabilityVerifierAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(capabilityVerifierAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_capability_catalog TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(capabilityVerifierAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const capabilityRuntimeAclHandle = await createHandle();
    await catalog.apply(capabilityRuntimeAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(capabilityRuntimeAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT SELECT ON vnext_control_plane.vnext_capability_catalog TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(capabilityRuntimeAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const capabilityTriggerHandle = await createHandle();
    await catalog.apply(capabilityTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(capabilityTriggerHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TRIGGER unapproved_capability_catalog_delete BEFORE DELETE ON vnext_control_plane.vnext_capability_catalog FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()',
    ));
    await assert.rejects(
      () => catalog.assert(capabilityTriggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const capabilityDefaultHandle = await createHandle();
    await catalog.apply(capabilityDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(capabilityDefaultHandle, 'fixture-provisioner', facade => facade.query(
      "ALTER TABLE vnext_control_plane.vnext_capability_catalog ALTER COLUMN status SET DEFAULT 'active'",
    ));
    await assert.rejects(
      () => catalog.assert(capabilityDefaultHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const capabilityPublicShadowHandle = await createHandle();
    await catalog.apply(capabilityPublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(capabilityPublicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_capability_catalog (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(capabilityPublicShadowHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const capabilityIndexHandle = await createHandle();
    await catalog.apply(capabilityIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(capabilityIndexHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX unapproved_capability_catalog_status_index ON vnext_control_plane.vnext_capability_catalog (status)',
    ));
    await assert.rejects(
      () => catalog.assert(capabilityIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const capabilityStatusConstraintHandle = await createHandle();
    await catalog.apply(capabilityStatusConstraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(capabilityStatusConstraintHandle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_capability_catalog DROP CONSTRAINT vnext_capability_catalog_status_check');
      await facade.query("ALTER TABLE vnext_control_plane.vnext_capability_catalog ADD CONSTRAINT vnext_capability_catalog_status_check CHECK (status IN ('active', 'retired', 'pending'))");
    });
    await assert.rejects(
      () => catalog.assert(capabilityStatusConstraintHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideVerifierAclHandle = await createHandle();
    await catalog.apply(overrideVerifierAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideVerifierAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_capability_overrides TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(overrideVerifierAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideRuntimeAclHandle = await createHandle();
    await catalog.apply(overrideRuntimeAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideRuntimeAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT SELECT ON vnext_control_plane.vnext_capability_overrides TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(overrideRuntimeAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideTriggerHandle = await createHandle();
    await catalog.apply(overrideTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideTriggerHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TRIGGER unapproved_capability_override_delete BEFORE DELETE ON vnext_control_plane.vnext_capability_overrides FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()',
    ));
    await assert.rejects(
      () => catalog.assert(overrideTriggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideDefaultHandle = await createHandle();
    await catalog.apply(overrideDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideDefaultHandle, 'fixture-provisioner', facade => facade.query(
      "ALTER TABLE vnext_control_plane.vnext_capability_overrides ALTER COLUMN effect SET DEFAULT 'allow'",
    ));
    await assert.rejects(
      () => catalog.assert(overrideDefaultHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overridePublicShadowHandle = await createHandle();
    await catalog.apply(overridePublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overridePublicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_capability_overrides (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(overridePublicShadowHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideIndexHandle = await createHandle();
    await catalog.apply(overrideIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideIndexHandle, 'fixture-provisioner', async facade => {
      await facade.query('DROP INDEX vnext_control_plane.vnext_capability_overrides_one_active_capability');
      await facade.query("CREATE UNIQUE INDEX vnext_capability_overrides_one_active_capability ON vnext_control_plane.vnext_capability_overrides (authority_id, account_id, capability_id) WHERE status = 'expired'");
    });
    await assert.rejects(
      () => catalog.assert(overrideIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideExtraIndexHandle = await createHandle();
    await catalog.apply(overrideExtraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideExtraIndexHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX unapproved_capability_override_status_index ON vnext_control_plane.vnext_capability_overrides (status)',
    ));
    await assert.rejects(
      () => catalog.assert(overrideExtraIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideEffectConstraintHandle = await createHandle();
    await catalog.apply(overrideEffectConstraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideEffectConstraintHandle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_capability_overrides DROP CONSTRAINT vnext_capability_overrides_effect_check');
      await facade.query("ALTER TABLE vnext_control_plane.vnext_capability_overrides ADD CONSTRAINT vnext_capability_overrides_effect_check CHECK (effect IN ('allow', 'deny', 'grant'))");
    });
    await assert.rejects(
      () => catalog.assert(overrideEffectConstraintHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideStatusConstraintHandle = await createHandle();
    await catalog.apply(overrideStatusConstraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideStatusConstraintHandle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_capability_overrides DROP CONSTRAINT vnext_capability_overrides_status_check');
      await facade.query("ALTER TABLE vnext_control_plane.vnext_capability_overrides ADD CONSTRAINT vnext_capability_overrides_status_check CHECK (status IN ('active', 'revoked', 'expired', 'pending'))");
    });
    await assert.rejects(
      () => catalog.assert(overrideStatusConstraintHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideForeignKeyHandle = await createHandle();
    await catalog.apply(overrideForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideForeignKeyHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_capability_overrides DROP CONSTRAINT vnext_capability_overrides_capability_id_fkey',
    ));
    await assert.rejects(
      () => catalog.assert(overrideForeignKeyHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const overrideAccountForeignKeyHandle = await createHandle();
    await catalog.apply(overrideAccountForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(overrideAccountForeignKeyHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_capability_overrides DROP CONSTRAINT vnext_capability_overrides_account_id_authority_id_fkey',
    ));
    await assert.rejects(
      () => catalog.assert(overrideAccountForeignKeyHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const scopeIndexHandle = await createHandle();
    await catalog.apply(scopeIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(scopeIndexHandle, 'fixture-provisioner', async facade => {
      await facade.query('DROP INDEX vnext_control_plane.vnext_data_scope_grants_one_active_scope');
      await facade.query("CREATE UNIQUE INDEX vnext_data_scope_grants_one_active_scope ON vnext_control_plane.vnext_data_scope_grants (authority_id, account_id, scope_type, scope_value_hash) WHERE status = 'expired'");
    });
    await assert.rejects(
      () => catalog.assert(scopeIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const scopeExtraIndexHandle = await createHandle();
    await catalog.apply(scopeExtraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(scopeExtraIndexHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX unapproved_scope_grant_status_index ON vnext_control_plane.vnext_data_scope_grants (status)',
    ));
    await assert.rejects(
      () => catalog.assert(scopeExtraIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    for (const [name, sql] of [
      ['scope-type', "ALTER TABLE vnext_control_plane.vnext_data_scope_grants DROP CONSTRAINT vnext_data_scope_grants_scope_type_check; ALTER TABLE vnext_control_plane.vnext_data_scope_grants ADD CONSTRAINT vnext_data_scope_grants_scope_type_check CHECK (scope_type IN ('teacher_profile', 'student_profile', 'school', 'household', 'resource_owner', 'other'))"],
      ['scope-status', "ALTER TABLE vnext_control_plane.vnext_data_scope_grants DROP CONSTRAINT vnext_data_scope_grants_status_check; ALTER TABLE vnext_control_plane.vnext_data_scope_grants ADD CONSTRAINT vnext_data_scope_grants_status_check CHECK (status IN ('active', 'revoked', 'expired', 'pending'))"],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', async facade => facade.query(sql));
      await assert.rejects(
        () => catalog.assert(driftHandle),
        error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
        name,
      );
    }

    const scopeForeignKeyHandle = await createHandle();
    await catalog.apply(scopeForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(scopeForeignKeyHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_data_scope_grants DROP CONSTRAINT vnext_data_scope_grants_account_id_authority_id_fkey',
    ));
    await assert.rejects(
      () => catalog.assert(scopeForeignKeyHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const scopeVerifierAclHandle = await createHandle();
    await catalog.apply(scopeVerifierAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(scopeVerifierAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_data_scope_grants TO vnext_pg17_verifier',
    ));
    await assert.rejects(
      () => catalog.assert(scopeVerifierAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const scopeTriggerHandle = await createHandle();
    await catalog.apply(scopeTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(scopeTriggerHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TRIGGER unapproved_scope_grant_delete BEFORE DELETE ON vnext_control_plane.vnext_data_scope_grants FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()',
    ));
    await assert.rejects(
      () => catalog.assert(scopeTriggerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const scopeDefaultHandle = await createHandle();
    await catalog.apply(scopeDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(scopeDefaultHandle, 'fixture-provisioner', facade => facade.query(
      "ALTER TABLE vnext_control_plane.vnext_data_scope_grants ALTER COLUMN effect SET DEFAULT 'allow'",
    ));
    await assert.rejects(
      () => catalog.assert(scopeDefaultHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const scopePublicShadowHandle = await createHandle();
    await catalog.apply(scopePublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(scopePublicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_data_scope_grants (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(scopePublicShadowHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    for (const [name, sql] of [
      ['account-type-index', "DROP INDEX vnext_control_plane.vnext_profile_bindings_one_active_account_type; CREATE UNIQUE INDEX vnext_profile_bindings_one_active_account_type ON vnext_control_plane.vnext_profile_bindings (authority_id, account_id, profile_type) WHERE status = 'pending'"],
      ['profile-index', "DROP INDEX vnext_control_plane.vnext_profile_bindings_one_active_profile; CREATE UNIQUE INDEX vnext_profile_bindings_one_active_profile ON vnext_control_plane.vnext_profile_bindings (authority_id, profile_type, profile_id) WHERE status = 'pending'"],
      ['profile-type-check', "ALTER TABLE vnext_control_plane.vnext_profile_bindings DROP CONSTRAINT vnext_profile_bindings_profile_type_check; ALTER TABLE vnext_control_plane.vnext_profile_bindings ADD CONSTRAINT vnext_profile_bindings_profile_type_check CHECK (profile_type IN ('teacher', 'student', 'other'))"],
      ['status-check', "ALTER TABLE vnext_control_plane.vnext_profile_bindings DROP CONSTRAINT vnext_profile_bindings_status_check; ALTER TABLE vnext_control_plane.vnext_profile_bindings ADD CONSTRAINT vnext_profile_bindings_status_check CHECK (status IN ('active', 'revoked', 'pending', 'other'))"],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(sql));
      await assert.rejects(() => catalog.assert(driftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT', name);
    }

    const profileExtraIndexHandle = await createHandle();
    await catalog.apply(profileExtraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(profileExtraIndexHandle, 'fixture-provisioner', facade => facade.query('CREATE INDEX unapproved_profile_binding_status_index ON vnext_control_plane.vnext_profile_bindings (status)'));
    await assert.rejects(() => catalog.assert(profileExtraIndexHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const profileForeignKeyHandle = await createHandle();
    await catalog.apply(profileForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(profileForeignKeyHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_profile_bindings DROP CONSTRAINT vnext_profile_bindings_account_id_authority_id_fkey'));
    await assert.rejects(() => catalog.assert(profileForeignKeyHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const profileDefaultHandle = await createHandle();
    await catalog.apply(profileDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(profileDefaultHandle, 'fixture-provisioner', facade => facade.query("ALTER TABLE vnext_control_plane.vnext_profile_bindings ALTER COLUMN status SET DEFAULT 'pending'"));
    await assert.rejects(() => catalog.assert(profileDefaultHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const profileAclHandle = await createHandle();
    await catalog.apply(profileAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(profileAclHandle, 'fixture-provisioner', facade => facade.query('GRANT INSERT ON vnext_control_plane.vnext_profile_bindings TO vnext_pg17_verifier'));
    await assert.rejects(() => catalog.assert(profileAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const profileTriggerHandle = await createHandle();
    await catalog.apply(profileTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(profileTriggerHandle, 'fixture-provisioner', facade => facade.query('CREATE TRIGGER unapproved_profile_binding_delete BEFORE DELETE ON vnext_control_plane.vnext_profile_bindings FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()'));
    await assert.rejects(() => catalog.assert(profileTriggerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const profilePublicShadowHandle = await createHandle();
    await catalog.apply(profilePublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(profilePublicShadowHandle, 'fixture-provisioner', facade => facade.query('CREATE TABLE public.vnext_profile_bindings (id integer)'));
    await assert.rejects(() => catalog.assert(profilePublicShadowHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const contactUniqueHandle = await createHandle();
    await catalog.apply(contactUniqueHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactUniqueHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_verified_contacts DROP CONSTRAINT vnext_verified_contacts_authority_id_contact_type_normalize_key; ALTER TABLE vnext_control_plane.vnext_verified_contacts ADD CONSTRAINT vnext_verified_contacts_authority_id_contact_type_normalize_key UNIQUE (authority_id, account_id, contact_type, normalized_value_hash)'));
    await assert.rejects(() => catalog.assert(contactUniqueHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    for (const [name, sql] of [
      ['contact-type', "ALTER TABLE vnext_control_plane.vnext_verified_contacts DROP CONSTRAINT vnext_verified_contacts_contact_type_check; ALTER TABLE vnext_control_plane.vnext_verified_contacts ADD CONSTRAINT vnext_verified_contacts_contact_type_check CHECK (contact_type IN ('phone', 'wechat_openid', 'wechat_unionid', 'other'))"],
      ['contact-state', "ALTER TABLE vnext_control_plane.vnext_verified_contacts DROP CONSTRAINT vnext_verified_contacts_verification_state_check; ALTER TABLE vnext_control_plane.vnext_verified_contacts ADD CONSTRAINT vnext_verified_contacts_verification_state_check CHECK (verification_state IN ('verified', 'revoked', 'pending'))"],
      ['contact-lifecycle', "ALTER TABLE vnext_control_plane.vnext_verified_contacts DROP CONSTRAINT vnext_verified_contacts_check1; ALTER TABLE vnext_control_plane.vnext_verified_contacts ADD CONSTRAINT vnext_verified_contacts_check1 CHECK (verification_state IN ('verified', 'revoked'))"],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(sql));
      await assert.rejects(() => catalog.assert(driftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT', name);
    }

    const contactExtraIndexHandle = await createHandle();
    await catalog.apply(contactExtraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactExtraIndexHandle, 'fixture-provisioner', facade => facade.query('CREATE INDEX unapproved_verified_contact_state_index ON vnext_control_plane.vnext_verified_contacts (verification_state)'));
    await assert.rejects(() => catalog.assert(contactExtraIndexHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const contactForeignKeyHandle = await createHandle();
    await catalog.apply(contactForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactForeignKeyHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_verified_contacts DROP CONSTRAINT vnext_verified_contacts_account_id_authority_id_fkey'));
    await assert.rejects(() => catalog.assert(contactForeignKeyHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const contactDefaultHandle = await createHandle();
    await catalog.apply(contactDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactDefaultHandle, 'fixture-provisioner', facade => facade.query("ALTER TABLE vnext_control_plane.vnext_verified_contacts ALTER COLUMN verification_state SET DEFAULT 'verified'"));
    await assert.rejects(() => catalog.assert(contactDefaultHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const contactVerifierAclHandle = await createHandle();
    await catalog.apply(contactVerifierAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactVerifierAclHandle, 'fixture-provisioner', facade => facade.query('GRANT INSERT ON vnext_control_plane.vnext_verified_contacts TO vnext_pg17_verifier'));
    await assert.rejects(() => catalog.assert(contactVerifierAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const contactRuntimeAclHandle = await createHandle();
    await catalog.apply(contactRuntimeAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactRuntimeAclHandle, 'fixture-provisioner', facade => facade.query('GRANT SELECT ON vnext_control_plane.vnext_verified_contacts TO vnext_pg17_runtime'));
    await assert.rejects(() => catalog.assert(contactRuntimeAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const contactTriggerHandle = await createHandle();
    await catalog.apply(contactTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactTriggerHandle, 'fixture-provisioner', facade => facade.query('CREATE TRIGGER unapproved_verified_contact_delete BEFORE DELETE ON vnext_control_plane.vnext_verified_contacts FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()'));
    await assert.rejects(() => catalog.assert(contactTriggerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const contactPublicShadowHandle = await createHandle();
    await catalog.apply(contactPublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(contactPublicShadowHandle, 'fixture-provisioner', facade => facade.query('CREATE TABLE public.vnext_verified_contacts (id integer)'));
    await assert.rejects(() => catalog.assert(contactPublicShadowHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptUniqueHandle = await createHandle();
    await catalog.apply(receiptUniqueHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptUniqueHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DROP CONSTRAINT vnext_authorization_command_receipt_receipt_id_authority_id_key CASCADE'));
    await assert.rejects(() => catalog.assert(receiptUniqueHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptResultConstraintHandle = await createHandle();
    await catalog.apply(receiptResultConstraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptResultConstraintHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DROP CONSTRAINT vnext_authorization_command_receipt_canonical_result_json_check; ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ADD CONSTRAINT vnext_authorization_command_receipt_canonical_result_json_check CHECK (canonical_result_json IS JSON)'));
    await assert.rejects(() => catalog.assert(receiptResultConstraintHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptOutcomeConstraintHandle = await createHandle();
    await catalog.apply(receiptOutcomeConstraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptOutcomeConstraintHandle, 'fixture-provisioner', facade => facade.query("ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DROP CONSTRAINT vnext_authorization_command_receipts_outcome_check; ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ADD CONSTRAINT vnext_authorization_command_receipts_outcome_check CHECK (outcome IN ('accepted', 'rejected', 'noop', 'pending'))"));
    await assert.rejects(() => catalog.assert(receiptOutcomeConstraintHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptVersionConstraintHandle = await createHandle();
    await catalog.apply(receiptVersionConstraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptVersionConstraintHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DROP CONSTRAINT vnext_authorization_command_receipts_expected_row_version_check; ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ADD CONSTRAINT vnext_authorization_command_receipts_expected_row_version_check CHECK (expected_row_version IS NULL OR expected_row_version >= -1)'));
    await assert.rejects(() => catalog.assert(receiptVersionConstraintHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptForeignKeyHandle = await createHandle();
    await catalog.apply(receiptForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptForeignKeyHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts DROP CONSTRAINT vnext_authorization_command_r_actor_account_id_authority_i_fkey'));
    await assert.rejects(() => catalog.assert(receiptForeignKeyHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptExtraIndexHandle = await createHandle();
    await catalog.apply(receiptExtraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptExtraIndexHandle, 'fixture-provisioner', facade => facade.query('CREATE INDEX unapproved_receipt_outcome_index ON vnext_control_plane.vnext_authorization_command_receipts (outcome)'));
    await assert.rejects(() => catalog.assert(receiptExtraIndexHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptDefaultHandle = await createHandle();
    await catalog.apply(receiptDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptDefaultHandle, 'fixture-provisioner', facade => facade.query("ALTER TABLE vnext_control_plane.vnext_authorization_command_receipts ALTER COLUMN outcome SET DEFAULT 'accepted'"));
    await assert.rejects(() => catalog.assert(receiptDefaultHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptVerifierAclHandle = await createHandle();
    await catalog.apply(receiptVerifierAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptVerifierAclHandle, 'fixture-provisioner', facade => facade.query('GRANT INSERT ON vnext_control_plane.vnext_authorization_command_receipts TO vnext_pg17_verifier'));
    await assert.rejects(() => catalog.assert(receiptVerifierAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptRuntimeAclHandle = await createHandle();
    await catalog.apply(receiptRuntimeAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptRuntimeAclHandle, 'fixture-provisioner', facade => facade.query('GRANT SELECT ON vnext_control_plane.vnext_authorization_command_receipts TO vnext_pg17_runtime'));
    await assert.rejects(() => catalog.assert(receiptRuntimeAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptFunctionHandle = await createHandle();
    await catalog.apply(receiptFunctionHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptFunctionHandle, 'fixture-provisioner', facade => facade.query("CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN OLD; END; $$"));
    await assert.rejects(() => catalog.assert(receiptFunctionHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptFunctionAclHandle = await createHandle();
    await catalog.apply(receiptFunctionAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptFunctionAclHandle, 'fixture-provisioner', facade => facade.query('GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update() TO vnext_pg17_runtime'));
    await assert.rejects(() => catalog.assert(receiptFunctionAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptFunctionPathHandle = await createHandle();
    await catalog.apply(receiptFunctionPathHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptFunctionPathHandle, 'fixture-provisioner', facade => facade.query('ALTER FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update() SET search_path = public, pg_temp'));
    await assert.rejects(() => catalog.assert(receiptFunctionPathHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptFunctionInvokerHandle = await createHandle();
    await catalog.apply(receiptFunctionInvokerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptFunctionInvokerHandle, 'fixture-provisioner', facade => facade.query('ALTER FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update() SECURITY INVOKER'));
    await assert.rejects(() => catalog.assert(receiptFunctionInvokerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptFunctionOwnerHandle = await createHandle();
    await catalog.apply(receiptFunctionOwnerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptFunctionOwnerHandle, 'fixture-provisioner', facade => facade.query('ALTER FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update() OWNER TO vnext_pg17_migrator'));
    await assert.rejects(() => catalog.assert(receiptFunctionOwnerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptVerifierFunctionAclHandle = await createHandle();
    await catalog.apply(receiptVerifierFunctionAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptVerifierFunctionAclHandle, 'fixture-provisioner', facade => facade.query('GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update() TO vnext_pg17_verifier'));
    await assert.rejects(() => catalog.assert(receiptVerifierFunctionAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptPublicFunctionAclHandle = await createHandle();
    await catalog.apply(receiptPublicFunctionAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptPublicFunctionAclHandle, 'fixture-provisioner', facade => facade.query('GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update() TO PUBLIC'));
    await assert.rejects(() => catalog.assert(receiptPublicFunctionAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptTriggerHandle = await createHandle();
    await catalog.apply(receiptTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptTriggerHandle, 'fixture-provisioner', facade => facade.query('CREATE TRIGGER unapproved_receipt_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_command_receipts FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()'));
    await assert.rejects(() => catalog.assert(receiptTriggerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptAlteredTriggerHandle = await createHandle();
    await catalog.apply(receiptAlteredTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptAlteredTriggerHandle, 'fixture-provisioner', facade => facade.query('DROP TRIGGER vnext_authorization_command_receipts_no_update ON vnext_control_plane.vnext_authorization_command_receipts; CREATE TRIGGER vnext_authorization_command_receipts_no_update BEFORE DELETE ON vnext_control_plane.vnext_authorization_command_receipts FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update()'));
    await assert.rejects(() => catalog.assert(receiptAlteredTriggerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptMissingTriggerHandle = await createHandle();
    await catalog.apply(receiptMissingTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptMissingTriggerHandle, 'fixture-provisioner', facade => facade.query('DROP TRIGGER vnext_authorization_command_receipts_no_delete ON vnext_control_plane.vnext_authorization_command_receipts'));
    await assert.rejects(() => catalog.assert(receiptMissingTriggerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const receiptPublicShadowHandle = await createHandle();
    await catalog.apply(receiptPublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(receiptPublicShadowHandle, 'fixture-provisioner', facade => facade.query('CREATE TABLE public.vnext_authorization_command_receipts (id integer)'));
    await assert.rejects(() => catalog.assert(receiptPublicShadowHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const auditUniqueHandle = await createHandle();
    await catalog.apply(auditUniqueHandle, migrationInput);
    await withVNextPg17SyntheticQuery(auditUniqueHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_audit_events DROP CONSTRAINT vnext_authorization_audit_events_authority_id_receipt_id_key; ALTER TABLE vnext_control_plane.vnext_authorization_audit_events ADD CONSTRAINT vnext_authorization_audit_events_authority_id_receipt_id_key UNIQUE (authority_id, receipt_id, reason_code)'));
    await assert.rejects(() => catalog.assert(auditUniqueHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    for (const [name, sql] of [
      ['auditAuthorityForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_audit_events DROP CONSTRAINT vnext_authorization_audit_events_authority_id_fkey'],
      ['auditReceiptForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_audit_events DROP CONSTRAINT vnext_authorization_audit_events_receipt_id_authority_id_fkey'],
      ['auditHashConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_audit_events DROP CONSTRAINT vnext_authorization_audit_events_context_sha256_check; ALTER TABLE vnext_control_plane.vnext_authorization_audit_events ADD CONSTRAINT vnext_authorization_audit_events_context_sha256_check CHECK (context_sha256 ~ '^[0-9a-f]+$')"],
      ['auditFiniteConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_audit_events DROP CONSTRAINT vnext_authorization_audit_events_created_at_check; ALTER TABLE vnext_control_plane.vnext_authorization_audit_events ADD CONSTRAINT vnext_authorization_audit_events_created_at_check CHECK (created_at <> 'infinity')"],
      ['auditDefaultHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_audit_events ALTER COLUMN reason_code SET DEFAULT 'generic.reason'"],
      ['auditNullabilityHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_audit_events ALTER COLUMN reason_code DROP NOT NULL'],
      ['auditOwnerHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_audit_events OWNER TO vnext_pg17_migrator'],
      ['auditVerifierAclHandle', 'GRANT INSERT ON vnext_control_plane.vnext_authorization_audit_events TO vnext_pg17_verifier'],
      ['auditRuntimeAclHandle', 'GRANT SELECT ON vnext_control_plane.vnext_authorization_audit_events TO vnext_pg17_runtime'],
      ['auditFunctionHandle', "CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN OLD; END; $$"],
      ['auditFunctionInvokerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update() SECURITY INVOKER'],
      ['auditFunctionOwnerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update() OWNER TO vnext_pg17_migrator'],
      ['auditFunctionPathHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update() SET search_path = public, pg_temp'],
      ['auditFunctionPublicExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update() TO PUBLIC'],
      ['auditFunctionVerifierExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update() TO vnext_pg17_verifier'],
      ['auditFunctionRuntimeExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update() TO vnext_pg17_runtime'],
      ['auditExtraTriggerHandle', 'CREATE TRIGGER unapproved_audit_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_audit_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()'],
      ['auditWrongTriggerHandle', 'DROP TRIGGER vnext_authorization_audit_events_no_update ON vnext_control_plane.vnext_authorization_audit_events; CREATE TRIGGER vnext_authorization_audit_events_no_update BEFORE DELETE ON vnext_control_plane.vnext_authorization_audit_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update()'],
      ['auditMissingTriggerHandle', 'DROP TRIGGER vnext_authorization_audit_events_no_delete ON vnext_control_plane.vnext_authorization_audit_events'],
      ['auditPublicShadowHandle', 'CREATE TABLE public.vnext_authorization_audit_events (id integer)'],
      ['auditExtraIndexHandle', 'CREATE INDEX unapproved_audit_reason_index ON vnext_control_plane.vnext_authorization_audit_events (reason_code)'],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(sql));
      await assert.rejects(() => catalog.assert(driftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT', name);
    }

    const outboxUniqueHandle = await createHandle();
    await catalog.apply(outboxUniqueHandle, migrationInput);
    await withVNextPg17SyntheticQuery(outboxUniqueHandle, 'fixture-provisioner', facade => facade.query('ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events DROP CONSTRAINT vnext_authorization_outbox_ev_authority_id_receipt_id_event_key; ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ADD CONSTRAINT vnext_authorization_outbox_ev_authority_id_receipt_id_event_key UNIQUE (authority_id, receipt_id, event_type, aggregate_kind)'));
    await assert.rejects(() => catalog.assert(outboxUniqueHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    for (const [name, sql] of [
      ['outboxAuthorityForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events DROP CONSTRAINT vnext_authorization_outbox_events_authority_id_fkey'],
      ['outboxReceiptForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events DROP CONSTRAINT vnext_authorization_outbox_events_receipt_id_authority_id_fkey'],
      ['outboxVersionConstraintHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events DROP CONSTRAINT vnext_authorization_outbox_events_aggregate_version_check; ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ADD CONSTRAINT vnext_authorization_outbox_events_aggregate_version_check CHECK (aggregate_version >= 0)'],
      ['outboxJsonConstraintHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events DROP CONSTRAINT vnext_authorization_outbox_events_canonical_payload_json_check; ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ADD CONSTRAINT vnext_authorization_outbox_events_canonical_payload_json_check CHECK (canonical_payload_json IS JSON)'],
      ['outboxHashConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events DROP CONSTRAINT vnext_authorization_outbox_events_payload_sha256_check; ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ADD CONSTRAINT vnext_authorization_outbox_events_payload_sha256_check CHECK (payload_sha256 ~ '^[0-9a-f]+$')"],
      ['outboxTimeConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events DROP CONSTRAINT vnext_authorization_outbox_events_occurred_at_check; ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ADD CONSTRAINT vnext_authorization_outbox_events_occurred_at_check CHECK (occurred_at <> 'infinity')"],
      ['outboxDefaultHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ALTER COLUMN event_type SET DEFAULT 'generic.event'"],
      ['outboxNullabilityHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ALTER COLUMN event_type DROP NOT NULL'],
      ['outboxCollationHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events ALTER COLUMN event_type TYPE text COLLATE "default"'],
      ['outboxExtraIndexHandle', 'CREATE INDEX unapproved_outbox_event_type_index ON vnext_control_plane.vnext_authorization_outbox_events (event_type)'],
      ['outboxOwnerHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_outbox_events OWNER TO vnext_pg17_migrator'],
      ['outboxVerifierAclHandle', 'GRANT INSERT ON vnext_control_plane.vnext_authorization_outbox_events TO vnext_pg17_verifier'],
      ['outboxRuntimeAclHandle', 'GRANT SELECT ON vnext_control_plane.vnext_authorization_outbox_events TO vnext_pg17_runtime'],
      ['outboxFunctionHandle', "CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN OLD; END; $$"],
      ['outboxFunctionInvokerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update() SECURITY INVOKER'],
      ['outboxFunctionOwnerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update() OWNER TO vnext_pg17_migrator'],
      ['outboxFunctionPathHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update() SET search_path = public, pg_temp'],
      ['outboxFunctionPublicExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update() TO PUBLIC'],
      ['outboxFunctionVerifierExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update() TO vnext_pg17_verifier'],
      ['outboxFunctionRuntimeExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update() TO vnext_pg17_runtime'],
      ['outboxExtraTriggerHandle', 'CREATE TRIGGER unapproved_outbox_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_outbox_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()'],
      ['outboxWrongTriggerHandle', 'DROP TRIGGER vnext_authorization_outbox_events_no_update ON vnext_control_plane.vnext_authorization_outbox_events; CREATE TRIGGER vnext_authorization_outbox_events_no_update BEFORE DELETE ON vnext_control_plane.vnext_authorization_outbox_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update()'],
      ['outboxMissingTriggerHandle', 'DROP TRIGGER vnext_authorization_outbox_events_no_delete ON vnext_control_plane.vnext_authorization_outbox_events'],
      ['outboxPublicShadowHandle', 'CREATE TABLE public.vnext_authorization_outbox_events (id integer)'],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(sql));
      await assert.rejects(() => catalog.assert(driftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT', name);
    }

    for (const [name, sql] of [
      ['bootstrapMarkerConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_bootstrap_consumptions DROP CONSTRAINT vnext_bootstrap_consumptions_marker_key_check; ALTER TABLE vnext_control_plane.vnext_bootstrap_consumptions ADD CONSTRAINT vnext_bootstrap_consumptions_marker_key_check CHECK (marker_key IN ('single-authority-bootstrap', 'other'))"],
      ['bootstrapAuthorityForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_bootstrap_consumptions ADD CONSTRAINT unapproved_bootstrap_authority_fkey FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities (authority_id)'],
      ['bootstrapExtraIndexHandle', 'CREATE INDEX unapproved_bootstrap_receipt_index ON vnext_control_plane.vnext_bootstrap_consumptions (receipt_id)'],
      ['bootstrapVerifierAclHandle', 'GRANT INSERT ON vnext_control_plane.vnext_bootstrap_consumptions TO vnext_pg17_verifier'],
      ['bootstrapRuntimeAclHandle', 'GRANT SELECT ON vnext_control_plane.vnext_bootstrap_consumptions TO vnext_pg17_runtime'],
      ['bootstrapFunctionInvokerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_update() SECURITY INVOKER'],
      ['bootstrapFunctionPublicExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_update() TO PUBLIC'],
      ['bootstrapWrongTriggerHandle', 'DROP TRIGGER vnext_bootstrap_consumptions_no_update ON vnext_control_plane.vnext_bootstrap_consumptions; CREATE TRIGGER vnext_bootstrap_consumptions_no_update BEFORE DELETE ON vnext_control_plane.vnext_bootstrap_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_update()'],
      ['bootstrapPublicShadowHandle', 'CREATE TABLE public.vnext_bootstrap_consumptions (id integer)'],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(sql));
      await assert.rejects(() => catalog.assert(driftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT', name);
    }

    for (const [name, sql] of [
      ['policyPublicationUniqueHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_pub_authority_id_policy_revision_key; ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ADD CONSTRAINT vnext_authorization_policy_pub_authority_id_policy_revision_key UNIQUE (authority_id, policy_revision, policy_contract_version)'],
      ['policyPublicationAuthorityForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_publications_authority_id_fkey'],
      ['policyPublicationReceiptForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_publica_receipt_id_authority_id_fkey'],
      ['policyPublicationRevisionConstraintHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_publications_policy_revision_check; ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ADD CONSTRAINT vnext_authorization_policy_publications_policy_revision_check CHECK (policy_revision >= 0)'],
      ['policyPublicationContractConstraintHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_public_policy_contract_version_check; ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ADD CONSTRAINT vnext_authorization_policy_public_policy_contract_version_check CHECK (policy_contract_version IN (1, 2))'],
      ['policyPublicationJsonConstraintHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_public_canonical_manifest_json_check; ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ADD CONSTRAINT vnext_authorization_policy_public_canonical_manifest_json_check CHECK (canonical_manifest_json IS JSON)'],
      ['policyPublicationHashConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_publica_policy_manifest_sha256_check; ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ADD CONSTRAINT vnext_authorization_policy_publica_policy_manifest_sha256_check CHECK (policy_manifest_sha256 ~ '^[0-9a-f]+$')"],
      ['policyPublicationTimeConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications DROP CONSTRAINT vnext_authorization_policy_publications_published_at_check; ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ADD CONSTRAINT vnext_authorization_policy_publications_published_at_check CHECK (published_at <> 'infinity')"],
      ['policyPublicationDefaultHandle', "ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ALTER COLUMN policy_contract_version SET DEFAULT 1"],
      ['policyPublicationNullabilityHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ALTER COLUMN canonical_manifest_json DROP NOT NULL'],
      ['policyPublicationCollationHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications ALTER COLUMN publication_id TYPE text COLLATE "default"'],
      ['policyPublicationExtraIndexHandle', 'CREATE INDEX unapproved_policy_publication_hash_index ON vnext_control_plane.vnext_authorization_policy_publications (policy_manifest_sha256)'],
      ['policyPublicationOwnerHandle', 'ALTER TABLE vnext_control_plane.vnext_authorization_policy_publications OWNER TO vnext_pg17_migrator'],
      ['policyPublicationVerifierAclHandle', 'GRANT INSERT ON vnext_control_plane.vnext_authorization_policy_publications TO vnext_pg17_verifier'],
      ['policyPublicationRuntimeAclHandle', 'GRANT SELECT ON vnext_control_plane.vnext_authorization_policy_publications TO vnext_pg17_runtime'],
      ['policyPublicationFunctionHandle', "CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN OLD; END; $$"],
      ['policyPublicationFunctionInvokerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() SECURITY INVOKER'],
      ['policyPublicationFunctionOwnerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() OWNER TO vnext_pg17_migrator'],
      ['policyPublicationFunctionPathHandle', 'ALTER FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() SET search_path = public, pg_temp'],
      ['policyPublicationFunctionPublicExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() TO PUBLIC'],
      ['policyPublicationFunctionVerifierExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() TO vnext_pg17_verifier'],
      ['policyPublicationFunctionRuntimeExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() TO vnext_pg17_runtime'],
      ['policyPublicationExtraTriggerHandle', 'CREATE TRIGGER unapproved_policy_publication_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()'],
      ['policyPublicationWrongTriggerHandle', 'DROP TRIGGER vnext_authorization_policy_publications_no_update ON vnext_control_plane.vnext_authorization_policy_publications; CREATE TRIGGER vnext_authorization_policy_publications_no_update BEFORE DELETE ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update()'],
      ['policyPublicationMissingTriggerHandle', 'DROP TRIGGER vnext_authorization_policy_publications_no_delete ON vnext_control_plane.vnext_authorization_policy_publications'],
      ['policyPublicationPublicShadowHandle', 'CREATE TABLE public.vnext_authorization_policy_publications (id integer)'],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(sql));
      await assert.rejects(() => catalog.assert(driftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT', name);
    }

    for (const [name, sql] of [
      ['trustEvidenceUniqueHandle', 'ALTER TABLE vnext_control_plane.vnext_trust_root_evidence DROP CONSTRAINT vnext_trust_root_evidence_actor_kind_event_id_key; ALTER TABLE vnext_control_plane.vnext_trust_root_evidence ADD CONSTRAINT vnext_trust_root_evidence_actor_kind_event_id_key UNIQUE (actor_kind, event_id, authority_id)'],
      ['trustEvidenceAuthorityForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_trust_root_evidence DROP CONSTRAINT vnext_trust_root_evidence_authority_id_fkey'],
      ['trustEvidenceReceiptForeignKeyHandle', 'ALTER TABLE vnext_control_plane.vnext_trust_root_evidence DROP CONSTRAINT vnext_trust_root_evidence_receipt_id_authority_id_fkey'],
      ['trustEvidenceActorKindConstraintHandle', "ALTER TABLE vnext_control_plane.vnext_trust_root_evidence DROP CONSTRAINT vnext_trust_root_evidence_actor_kind_check; ALTER TABLE vnext_control_plane.vnext_trust_root_evidence ADD CONSTRAINT vnext_trust_root_evidence_actor_kind_check CHECK (actor_kind IN ('deployment_bootstrap', 'owner_recovery_event', 'other'))"],
      ['trustEvidenceBackupConstraintHandle', 'ALTER TABLE vnext_control_plane.vnext_trust_root_evidence DROP CONSTRAINT vnext_trust_root_evidence_check; ALTER TABLE vnext_control_plane.vnext_trust_root_evidence ADD CONSTRAINT vnext_trust_root_evidence_check CHECK (true)'],
      ['trustEvidenceExtraIndexHandle', 'CREATE INDEX unapproved_trust_evidence_event_index ON vnext_control_plane.vnext_trust_root_evidence (event_id)'],
      ['trustEvidenceVerifierAclHandle', 'GRANT INSERT ON vnext_control_plane.vnext_trust_root_evidence TO vnext_pg17_verifier'],
      ['trustEvidenceRuntimeAclHandle', 'GRANT SELECT ON vnext_control_plane.vnext_trust_root_evidence TO vnext_pg17_runtime'],
      ['trustEvidenceFunctionInvokerHandle', 'ALTER FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_update() SECURITY INVOKER'],
      ['trustEvidenceFunctionPublicExecuteHandle', 'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_update() TO PUBLIC'],
      ['trustEvidenceWrongTriggerHandle', 'DROP TRIGGER vnext_trust_root_evidence_no_update ON vnext_control_plane.vnext_trust_root_evidence; CREATE TRIGGER vnext_trust_root_evidence_no_update BEFORE DELETE ON vnext_control_plane.vnext_trust_root_evidence FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_update()'],
      ['trustEvidencePublicShadowHandle', 'CREATE TABLE public.vnext_trust_root_evidence (id integer)'],
    ]) {
      const driftHandle = await createHandle();
      await catalog.apply(driftHandle, migrationInput);
      await withVNextPg17SyntheticQuery(driftHandle, 'fixture-provisioner', facade => facade.query(sql));
      await assert.rejects(() => catalog.assert(driftHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT', name);
    }

    const schemaMetaHandle = await createHandle();
    await catalog.apply(schemaMetaHandle, migrationInput);
    await withVNextPg17SyntheticQuery(schemaMetaHandle, 'fixture-provisioner', facade => facade.query(
      'DELETE FROM vnext_control_plane.vnext_schema_meta',
    ));
    await assert.rejects(
      () => catalog.assert(schemaMetaHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await assert.rejects(
      () => catalog.apply(schemaMetaHandle, migrationInput),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const schemaMetaTimestampHandle = await createHandle();
    await catalog.apply(schemaMetaTimestampHandle, migrationInput);
    await withVNextPg17SyntheticQuery(schemaMetaTimestampHandle, 'fixture-provisioner', facade => facade.query(
      "UPDATE vnext_control_plane.vnext_schema_meta SET applied_at = '2026-08-15T00:00:01.000Z'",
    ));
    await assert.rejects(
      () => catalog.assert(schemaMetaTimestampHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const foundationDefaultHandle = await createHandle();
    await catalog.apply(foundationDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(foundationDefaultHandle, 'fixture-provisioner', facade => facade.query(
      "ALTER TABLE vnext_control_plane.vnext_authorities ALTER COLUMN status SET DEFAULT 'active'",
    ));
    await assert.rejects(
      () => catalog.assert(foundationDefaultHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const constraintHandle = await createHandle();
    await catalog.apply(constraintHandle, migrationInput);
    await withVNextPg17SyntheticQuery(constraintHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations DROP CONSTRAINT vnext_schema_migrations_semantic_version_key',
    ));
    await assert.rejects(
      () => catalog.assert(constraintHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const functionSourceHandle = await createHandle();
    await catalog.apply(functionSourceHandle, migrationInput);
    await withVNextPg17SyntheticQuery(functionSourceHandle, 'fixture-provisioner', facade => facade.query(
      "CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN OLD; END; $$",
    ));
    await assert.rejects(
      () => catalog.assert(functionSourceHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const checkDefinitionHandle = await createHandle();
    await catalog.apply(checkDefinitionHandle, migrationInput);
    await withVNextPg17SyntheticQuery(checkDefinitionHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations DROP CONSTRAINT vnext_schema_migrations_semantic_version_check',
    ));
    await withVNextPg17SyntheticQuery(checkDefinitionHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations ADD CONSTRAINT vnext_schema_migrations_semantic_version_check CHECK (semantic_version >= 0)',
    ));
    await assert.rejects(
      () => catalog.assert(checkDefinitionHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const nullabilityHandle = await createHandle();
    await catalog.apply(nullabilityHandle, migrationInput);
    await withVNextPg17SyntheticQuery(nullabilityHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_schema_migrations ALTER COLUMN applied_by DROP NOT NULL',
    ));
    await assert.rejects(
      () => catalog.assert(nullabilityHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const functionAclHandle = await createHandle();
    await catalog.apply(functionAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(functionAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() TO PUBLIC',
    ));
    await assert.rejects(
      () => catalog.assert(functionAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const roleHandle = await createHandle();
    await catalog.apply(roleHandle, migrationInput);
    await withVNextPg17SyntheticQuery(roleHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_owner LOGIN',
    ));
    await assert.rejects(
      () => catalog.assert(roleHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(roleHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_owner NOLOGIN',
    ));
    await assert.doesNotReject(() => catalog.assert(roleHandle));

    const publicSchemaAclHandle = await createHandle();
    await catalog.apply(publicSchemaAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(publicSchemaAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT CREATE ON SCHEMA public TO PUBLIC',
    ));
    await assert.rejects(
      () => catalog.assert(publicSchemaAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const databaseTempAclHandle = await createHandle();
    await catalog.apply(databaseTempAclHandle, migrationInput);
    const database = await withVNextPg17SyntheticQuery(databaseTempAclHandle, 'fixture-provisioner', facade => facade.query(
      'SELECT current_database() AS database_name',
    ));
    assert.match(database.rows[0].database_name, /^vnextpg17_[a-z0-9]+$/);
    await withVNextPg17SyntheticQuery(databaseTempAclHandle, 'fixture-provisioner', facade => facade.query(
      `GRANT TEMPORARY ON DATABASE "${database.rows[0].database_name}" TO PUBLIC`,
    ));
    await assert.rejects(
      () => catalog.assert(databaseTempAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeLedgerAclHandle = await createHandle();
    await catalog.apply(runtimeLedgerAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(runtimeLedgerAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT SELECT ON vnext_control_plane.vnext_schema_migrations TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(runtimeLedgerAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeSchemaAclHandle = await createHandle();
    await catalog.apply(runtimeSchemaAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(runtimeSchemaAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT CREATE ON SCHEMA vnext_control_plane TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(runtimeSchemaAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const membershipHandle = await createHandle();
    await catalog.apply(membershipHandle, migrationInput);
    await withVNextPg17SyntheticQuery(membershipHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT vnext_pg17_owner TO vnext_pg17_runtime',
    ));
    await assert.rejects(
      () => catalog.assert(membershipHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(membershipHandle, 'fixture-provisioner', facade => facade.query(
      'REVOKE vnext_pg17_owner FROM vnext_pg17_runtime',
    ));
    await assert.doesNotReject(() => catalog.assert(membershipHandle));

    const publicShadowHandle = await createHandle();
    await catalog.apply(publicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(publicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_schema_migrations (id integer)',
    ));
    await assert.rejects(
      () => catalog.assert(publicShadowHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const extraIndexHandle = await createHandle();
    await catalog.apply(extraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(extraIndexHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX unapproved_applied_by_index ON vnext_control_plane.vnext_schema_migrations (applied_by)',
    ));
    await assert.rejects(
      () => catalog.assert(extraIndexHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const extraViewHandle = await createHandle();
    await catalog.apply(extraViewHandle, migrationInput);
    await withVNextPg17SyntheticQuery(extraViewHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE VIEW vnext_control_plane.unapproved_target_view AS SELECT 1 AS id',
    ));
    await assert.rejects(
      () => catalog.assert(extraViewHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const runtimeDatabaseAclHandle = await createHandle();
    await catalog.apply(runtimeDatabaseAclHandle, migrationInput);
    const runtimeDatabase = await withVNextPg17SyntheticQuery(runtimeDatabaseAclHandle, 'fixture-provisioner', facade => facade.query(
      'SELECT current_database() AS database_name',
    ));
    assert.match(runtimeDatabase.rows[0].database_name, /^vnextpg17_[a-z0-9]+$/);
    await withVNextPg17SyntheticQuery(runtimeDatabaseAclHandle, 'fixture-provisioner', facade => facade.query(
      `GRANT CREATE ON DATABASE "${runtimeDatabase.rows[0].database_name}" TO vnext_pg17_runtime`,
    ));
    await assert.rejects(
      () => catalog.assert(runtimeDatabaseAclHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const databaseOwnerHandle = await createHandle();
    await catalog.apply(databaseOwnerHandle, migrationInput);
    const ownerDatabase = await withVNextPg17SyntheticQuery(databaseOwnerHandle, 'fixture-provisioner', facade => facade.query(
      'SELECT current_database() AS database_name',
    ));
    assert.match(ownerDatabase.rows[0].database_name, /^vnextpg17_[a-z0-9]+$/);
    await withVNextPg17SyntheticQuery(databaseOwnerHandle, 'fixture-provisioner', facade => facade.query(
      `ALTER DATABASE "${ownerDatabase.rows[0].database_name}" OWNER TO vnext_pg17_migrator`,
    ));
    await assert.rejects(
      () => catalog.assert(databaseOwnerHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );

    const rolePrivilegeHandle = await createHandle();
    await catalog.apply(rolePrivilegeHandle, migrationInput);
    await withVNextPg17SyntheticQuery(rolePrivilegeHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_runtime CREATEROLE',
    ));
    await assert.rejects(
      () => catalog.assert(rolePrivilegeHandle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await withVNextPg17SyntheticQuery(rolePrivilegeHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER ROLE vnext_pg17_runtime NOCREATEROLE',
    ));
    await assert.doesNotReject(() => catalog.assert(rolePrivilegeHandle));

    const sessionsExtraIndexHandle = await createHandle();
    await catalog.apply(sessionsExtraIndexHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionsExtraIndexHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE INDEX unapproved_sessions_status_index ON vnext_control_plane.vnext_sessions (status)',
    ));
    await assert.rejects(() => catalog.assert(sessionsExtraIndexHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthForeignKeyHandle = await createHandle();
    await catalog.apply(reauthForeignKeyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthForeignKeyHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_recent_reauthentication_events DROP CONSTRAINT vnext_recent_reauthentication_even_session_id_authority_id_fkey',
    ));
    await assert.rejects(() => catalog.assert(reauthForeignKeyHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionsRuntimeAclHandle = await createHandle();
    await catalog.apply(sessionsRuntimeAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionsRuntimeAclHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT SELECT ON vnext_control_plane.vnext_sessions TO vnext_pg17_runtime',
    ));
    await assert.rejects(() => catalog.assert(sessionsRuntimeAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthTriggerHandle = await createHandle();
    await catalog.apply(reauthTriggerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthTriggerHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_recent_reauthentication_events DISABLE TRIGGER vnext_recent_reauthentication_events_no_delete',
    ));
    await assert.rejects(() => catalog.assert(reauthTriggerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionEnumHandle = await createHandle();
    await catalog.apply(sessionEnumHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionEnumHandle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_sessions DROP CONSTRAINT vnext_sessions_session_kind_check');
      await facade.query("ALTER TABLE vnext_control_plane.vnext_sessions ADD CONSTRAINT vnext_sessions_session_kind_check CHECK (session_kind IN ('online','initialization','offline'))");
    });
    await assert.rejects(() => catalog.assert(sessionEnumHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthWindowHandle = await createHandle();
    await catalog.apply(reauthWindowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthWindowHandle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_recent_reauthentication_events DROP CONSTRAINT vnext_recent_reauthentication_events_check');
      await facade.query('ALTER TABLE vnext_control_plane.vnext_recent_reauthentication_events ADD CONSTRAINT vnext_recent_reauthentication_events_check CHECK (expires_at >= verified_at)');
    });
    await assert.rejects(() => catalog.assert(reauthWindowHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionLifecycleHandle = await createHandle();
    await catalog.apply(sessionLifecycleHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionLifecycleHandle, 'fixture-provisioner', async facade => {
      await facade.query('ALTER TABLE vnext_control_plane.vnext_sessions DROP CONSTRAINT vnext_sessions_check3');
      await facade.query('ALTER TABLE vnext_control_plane.vnext_sessions ADD CONSTRAINT vnext_sessions_check3 CHECK (status IN (\'active\',\'revoked\',\'expired\'))');
    });
    await assert.rejects(() => catalog.assert(sessionLifecycleHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthDefaultHandle = await createHandle();
    await catalog.apply(reauthDefaultHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthDefaultHandle, 'fixture-provisioner', facade => facade.query(
      "ALTER TABLE vnext_control_plane.vnext_recent_reauthentication_events ALTER COLUMN factor_class SET DEFAULT 'password'",
    ));
    await assert.rejects(() => catalog.assert(reauthDefaultHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthNullabilityHandle = await createHandle();
    await catalog.apply(reauthNullabilityHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthNullabilityHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_recent_reauthentication_events ALTER COLUMN evidence_sha256 DROP NOT NULL',
    ));
    await assert.rejects(() => catalog.assert(reauthNullabilityHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionsOwnerHandle = await createHandle();
    await catalog.apply(sessionsOwnerHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionsOwnerHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_sessions OWNER TO vnext_pg17_migrator',
    ));
    await assert.rejects(() => catalog.assert(sessionsOwnerHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionFunctionSecurityHandle = await createHandle();
    await catalog.apply(sessionFunctionSecurityHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionFunctionSecurityHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER FUNCTION vnext_control_plane.vnext_sessions_no_delete() SECURITY INVOKER',
    ));
    await assert.rejects(() => catalog.assert(sessionFunctionSecurityHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthFunctionPathHandle = await createHandle();
    await catalog.apply(reauthFunctionPathHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthFunctionPathHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_delete() SET search_path TO public',
    ));
    await assert.rejects(() => catalog.assert(reauthFunctionPathHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionPublicExecuteHandle = await createHandle();
    await catalog.apply(sessionPublicExecuteHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionPublicExecuteHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_sessions_no_delete() TO PUBLIC',
    ));
    await assert.rejects(() => catalog.assert(sessionPublicExecuteHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionsPublicShadowHandle = await createHandle();
    await catalog.apply(sessionsPublicShadowHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionsPublicShadowHandle, 'fixture-provisioner', facade => facade.query(
      'CREATE TABLE public.vnext_sessions (id integer)',
    ));
    await assert.rejects(() => catalog.assert(sessionsPublicShadowHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthFunctionBodyHandle = await createHandle();
    await catalog.apply(reauthFunctionBodyHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthFunctionBodyHandle, 'fixture-provisioner', facade => facade.query(
      "CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN OLD; END; $$",
    ));
    await assert.rejects(() => catalog.assert(reauthFunctionBodyHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const sessionTriggerEventHandle = await createHandle();
    await catalog.apply(sessionTriggerEventHandle, migrationInput);
    await withVNextPg17SyntheticQuery(sessionTriggerEventHandle, 'fixture-provisioner', async facade => {
      await facade.query('DROP TRIGGER vnext_sessions_no_delete ON vnext_control_plane.vnext_sessions');
      await facade.query('CREATE TRIGGER vnext_sessions_no_delete BEFORE UPDATE ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_no_delete()');
    });
    await assert.rejects(() => catalog.assert(sessionTriggerEventHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const reauthCollationHandle = await createHandle();
    await catalog.apply(reauthCollationHandle, migrationInput);
    await withVNextPg17SyntheticQuery(reauthCollationHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER TABLE vnext_control_plane.vnext_recent_reauthentication_events ALTER COLUMN factor_class TYPE text COLLATE "default"',
    ));
    await assert.rejects(() => catalog.assert(reauthCollationHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const writerRoleHandle = await createHandle();
    await catalog.apply(writerRoleHandle, migrationInput);
    try {
      await withVNextPg17SyntheticQuery(writerRoleHandle, 'fixture-provisioner', facade => facade.query(
        'ALTER ROLE vnext_pg17_writer INHERIT',
      ));
      await assert.rejects(() => catalog.assert(writerRoleHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
    } finally {
      await withVNextPg17SyntheticQuery(writerRoleHandle, 'fixture-provisioner', facade => facade.query(
        'ALTER ROLE vnext_pg17_writer NOINHERIT',
      ));
    }

    const writerDmlHandle = await createHandle();
    await catalog.apply(writerDmlHandle, migrationInput);
    await withVNextPg17SyntheticQuery(writerDmlHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_authorities TO vnext_pg17_writer',
    ));
    await assert.rejects(() => catalog.assert(writerDmlHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const writerFunctionHandle = await createHandle();
    await catalog.apply(writerFunctionHandle, migrationInput);
    await withVNextPg17SyntheticQuery(writerFunctionHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_sessions_no_delete() TO vnext_pg17_writer',
    ));
    await assert.rejects(() => catalog.assert(writerFunctionHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const writerDefaultAclHandle = await createHandle();
    await catalog.apply(writerDefaultAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(writerDefaultAclHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE vnext_pg17_owner IN SCHEMA vnext_control_plane GRANT SELECT ON TABLES TO vnext_pg17_writer',
    ));
    await assert.rejects(() => catalog.assert(writerDefaultAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const writerPublicDefaultAclHandle = await createHandle();
    await catalog.apply(writerPublicDefaultAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(writerPublicDefaultAclHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE vnext_pg17_owner IN SCHEMA vnext_control_plane GRANT INSERT ON TABLES TO PUBLIC',
    ));
    await assert.rejects(() => catalog.assert(writerPublicDefaultAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const writerGlobalDefaultAclHandle = await createHandle();
    await catalog.apply(writerGlobalDefaultAclHandle, migrationInput);
    await withVNextPg17SyntheticQuery(writerGlobalDefaultAclHandle, 'fixture-provisioner', facade => facade.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE vnext_pg17_owner GRANT INSERT ON TABLES TO PUBLIC',
    ));
    await assert.rejects(() => catalog.assert(writerGlobalDefaultAclHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const onlineIdentityPublicExecuteHandle = await createHandle();
    await catalog.apply(onlineIdentityPublicExecuteHandle, migrationInput);
    await withVNextPg17SyntheticQuery(onlineIdentityPublicExecuteHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_issue_online_identity_assertion(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) TO PUBLIC',
    ));
    await assert.rejects(() => catalog.assert(onlineIdentityPublicExecuteHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');

    const onlineIdentityWriterDmlHandle = await createHandle();
    await catalog.apply(onlineIdentityWriterDmlHandle, migrationInput);
    await withVNextPg17SyntheticQuery(onlineIdentityWriterDmlHandle, 'fixture-provisioner', facade => facade.query(
      'GRANT INSERT ON vnext_control_plane.vnext_online_identity_assertions TO vnext_pg17_writer',
    ));
    await assert.rejects(() => catalog.assert(onlineIdentityWriterDmlHandle), error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT');
  } finally {
    if (priorHandle) {
      await runtime.disposeHandle(priorHandle);
    }
  }
}

async function main() {
  const runtime = createDisposablePg17Runtime();
  try {
    await runtime.start();
    await runCatalogAssertionCases(runtime);
  } finally {
    await runtime.stop();
  }
  console.log('vNext PG17 catalog assertion checks passed');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runCatalogAssertionCases };
