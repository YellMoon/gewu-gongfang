'use strict';

const assert = require('assert');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('./disposableRuntime');
const { createVNextPg17CatalogBoundary } = require('./catalogAssertion');
const {
  FIRST_MIGRATION,
  FOUNDATION_IDENTITY_DEVICE_MIGRATION,
  ROLE_GRANTS_MIGRATION,
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
        'SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
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
    const handle = await createHandle();
    await assert.rejects(
      () => catalog.assert(handle),
      error => error && error.code === 'VNEXT_PG17_SCHEMA_DRIFT',
    );
    await catalog.apply(handle, migrationInput);
    await withVNextPg17SyntheticQuery(handle, 'verifier', async facade => {
      const ledgerRows = await facade.query(
        'SELECT semantic_version::text AS semantic_version FROM vnext_control_plane.vnext_schema_migrations ORDER BY semantic_version',
      );
      assert.deepStrictEqual(ledgerRows.rows, [{ semantic_version: '1' }, { semantic_version: '2' }, { semantic_version: '3' }, { semantic_version: '4' }]);
      const schemaMetaRows = await facade.query(
        'SELECT schema_key, schema_version::text AS schema_version FROM vnext_control_plane.vnext_schema_meta',
      );
      assert.deepStrictEqual(schemaMetaRows.rows, [{ schema_key: 'control-plane-reference', schema_version: '5' }]);
      const roleGrantCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_role_grants');
      assert.deepStrictEqual(roleGrantCount.rows, [{ count: '0' }]);
      const capabilityCount = await facade.query('SELECT COUNT(*)::text AS count FROM vnext_control_plane.vnext_capability_catalog');
      assert.deepStrictEqual(capabilityCount.rows, [{ count: '0' }]);
    });
    await assert.doesNotReject(() => catalog.assert(handle));
    await assertFoundationSemantics(handle);
    await assertRoleGrantSemantics(handle);
    await assertCapabilityCatalogSemantics(handle);
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
        "INSERT INTO vnext_control_plane.vnext_schema_migrations (migration_id, semantic_version, manifest_sha256, applied_at, applied_by) VALUES ('future', 6, repeat('a', 64), now(), 'fixture')",
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
