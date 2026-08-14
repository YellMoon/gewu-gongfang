'use strict';

const { createHash } = require('crypto');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const sql = `CREATE SCHEMA vnext_control_plane AUTHORIZATION vnext_pg17_owner;
REVOKE CREATE ON SCHEMA vnext_control_plane FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE vnext_control_plane.vnext_schema_migrations (
  migration_id text COLLATE "C" PRIMARY KEY CHECK (btrim(migration_id) <> ''),
  semantic_version bigint NOT NULL UNIQUE CHECK (semantic_version > 0),
  manifest_sha256 text COLLATE "C" NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL CHECK (applied_at <> 'infinity'::timestamptz AND applied_at <> '-infinity'::timestamptz),
  applied_by text COLLATE "C" NOT NULL CHECK (btrim(applied_by) <> '')
);
CREATE FUNCTION vnext_control_plane.vnext_schema_migrations_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE expected_version bigint;
BEGIN
  SELECT COALESCE(MAX(semantic_version), 0) + 1
    INTO expected_version
    FROM vnext_control_plane.vnext_schema_migrations;
  IF NEW.semantic_version <> expected_version THEN
    RAISE EXCEPTION 'vNext schema migration semantic version is not contiguous' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_schema_migrations_no_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'vNext schema migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'vNext schema migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER vnext_schema_migrations_insert_guard
BEFORE INSERT ON vnext_control_plane.vnext_schema_migrations
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_insert_guard();
CREATE TRIGGER vnext_schema_migrations_no_update
BEFORE UPDATE ON vnext_control_plane.vnext_schema_migrations
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_update();
CREATE TRIGGER vnext_schema_migrations_no_delete
BEFORE DELETE ON vnext_control_plane.vnext_schema_migrations
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_schema_migrations_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_schema_migrations_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete() FROM PUBLIC;
GRANT USAGE ON SCHEMA vnext_control_plane TO vnext_pg17_verifier;
GRANT SELECT ON TABLE vnext_control_plane.vnext_schema_migrations TO vnext_pg17_verifier;`;

const FIRST_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-ledger-1',
  semanticVersion: 1,
  sql,
  manifestSha256: sha256(sql),
});

const FOUNDATION_IDENTITY_DEVICE_SQL = `CREATE TABLE vnext_control_plane.vnext_schema_meta (
  schema_key text COLLATE "C" PRIMARY KEY
    CHECK (btrim(schema_key) <> '' AND schema_key = 'control-plane-reference'),
  schema_version bigint NOT NULL CHECK (schema_version = 5),
  applied_at timestamptz NOT NULL
    CHECK (applied_at <> 'infinity'::timestamptz AND applied_at <> '-infinity'::timestamptz)
);
CREATE TABLE vnext_control_plane.vnext_authorities (
  authority_id text COLLATE "C" PRIMARY KEY CHECK (btrim(authority_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  CHECK (updated_at >= created_at)
);
CREATE TABLE vnext_control_plane.vnext_accounts (
  account_id text COLLATE "C" PRIMARY KEY CHECK (btrim(account_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  auth_version bigint NOT NULL CHECK (auth_version >= 1),
  access_version bigint NOT NULL CHECK (access_version >= 1),
  revocation_version bigint NOT NULL CHECK (revocation_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  UNIQUE (account_id, authority_id),
  FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at)
);
CREATE TABLE vnext_control_plane.vnext_trusted_devices (
  device_id text COLLATE "C" PRIMARY KEY CHECK (btrim(device_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'risk_limited', 'revoked', 'retired')),
  hardware_evidence_hash text COLLATE "C" CHECK (hardware_evidence_hash IS NULL OR hardware_evidence_hash ~ '^[0-9a-f]{64}$'),
  risk_code text COLLATE "C" CHECK (risk_code IS NULL OR btrim(risk_code) <> ''),
  credential_version bigint NOT NULL CHECK (credential_version >= 1),
  risk_version bigint NOT NULL CHECK (risk_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  UNIQUE (device_id, authority_id),
  FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status <> 'revoked' AND revoked_at IS NULL))
);
CREATE TABLE vnext_control_plane.vnext_device_installations (
  installation_id text COLLATE "C" PRIMARY KEY CHECK (btrim(installation_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  device_id text COLLATE "C" NOT NULL CHECK (btrim(device_id) <> ''),
  installation_public_key text COLLATE "C" NOT NULL CHECK (btrim(installation_public_key) <> ''),
  key_fingerprint text COLLATE "C" NOT NULL CHECK (key_fingerprint ~ '^[0-9a-f]{64}$'),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'revoked', 'retired')),
  credential_version bigint NOT NULL CHECK (credential_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  UNIQUE (installation_id, device_id, authority_id),
  UNIQUE (authority_id, key_fingerprint),
  FOREIGN KEY (device_id, authority_id)
    REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status <> 'revoked' AND revoked_at IS NULL))
);
CREATE TABLE vnext_control_plane.vnext_account_device_links (
  link_id text COLLATE "C" PRIMARY KEY CHECK (btrim(link_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  device_id text COLLATE "C" NOT NULL CHECK (btrim(device_id) <> ''),
  installation_id text COLLATE "C" NOT NULL CHECK (btrim(installation_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  auth_version bigint NOT NULL CHECK (auth_version >= 1),
  access_version bigint NOT NULL CHECK (access_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  UNIQUE (authority_id, account_id, installation_id),
  UNIQUE (link_id, authority_id, account_id, device_id, installation_id),
  FOREIGN KEY (account_id, authority_id)
    REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (device_id, authority_id)
    REFERENCES vnext_control_plane.vnext_trusted_devices(device_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (installation_id, device_id, authority_id)
    REFERENCES vnext_control_plane.vnext_device_installations(installation_id, device_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status = 'expired' AND revoked_at IS NULL) OR status = 'active')
);
GRANT SELECT ON TABLE
  vnext_control_plane.vnext_schema_meta,
  vnext_control_plane.vnext_authorities,
  vnext_control_plane.vnext_accounts,
  vnext_control_plane.vnext_trusted_devices,
  vnext_control_plane.vnext_device_installations,
  vnext_control_plane.vnext_account_device_links
TO vnext_pg17_verifier;`;

const FOUNDATION_IDENTITY_DEVICE_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-foundation-identity-device-2',
  semanticVersion: 2,
  sql: FOUNDATION_IDENTITY_DEVICE_SQL,
  manifestSha256: sha256(FOUNDATION_IDENTITY_DEVICE_SQL),
  postApply: Object.freeze({
    text: 'INSERT INTO vnext_control_plane.vnext_schema_meta (schema_key, schema_version, applied_at) VALUES ($1, $2, $3)',
    values: appliedAt => ['control-plane-reference', '5', appliedAt],
  }),
});

const ROLE_GRANTS_SQL = `CREATE TABLE vnext_control_plane.vnext_role_grants (
  grant_id text COLLATE "C" PRIMARY KEY CHECK (btrim(grant_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  role text COLLATE "C" NOT NULL CHECK (role IN ('super_admin', 'teacher', 'student')),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  grant_version bigint NOT NULL CHECK (grant_version >= 1),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  starts_at timestamptz NOT NULL CHECK (starts_at <> 'infinity'::timestamptz AND starts_at <> '-infinity'::timestamptz),
  ends_at timestamptz CHECK (ends_at <> 'infinity'::timestamptz AND ends_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  granted_by_account_id text COLLATE "C" CHECK (granted_by_account_id IS NULL OR btrim(granted_by_account_id) <> ''),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  FOREIGN KEY (account_id, authority_id)
    REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (granted_by_account_id, authority_id)
    REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'expired' AND ends_at IS NOT NULL AND revoked_at IS NULL)
  )
);
CREATE UNIQUE INDEX vnext_role_grants_one_active_role
  ON vnext_control_plane.vnext_role_grants(authority_id, account_id, role)
  WHERE status = 'active';
GRANT SELECT ON TABLE vnext_control_plane.vnext_role_grants TO vnext_pg17_verifier;`;

const ROLE_GRANTS_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-role-grants-3',
  semanticVersion: 3,
  sql: ROLE_GRANTS_SQL,
  manifestSha256: sha256(ROLE_GRANTS_SQL),
});

const CAPABILITY_CATALOG_SQL = `CREATE TABLE vnext_control_plane.vnext_capability_catalog (
  capability_id text COLLATE "C" PRIMARY KEY CHECK (btrim(capability_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'retired')),
  surface_mask text COLLATE "C" NOT NULL CHECK (btrim(surface_mask) <> ''),
  created_at timestamptz NOT NULL CHECK (
    created_at <> 'infinity'::timestamptz
    AND created_at <> '-infinity'::timestamptz
  )
);
GRANT SELECT ON TABLE vnext_control_plane.vnext_capability_catalog TO vnext_pg17_verifier;`;

const CAPABILITY_CATALOG_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-capability-catalog-4',
  semanticVersion: 4,
  sql: CAPABILITY_CATALOG_SQL,
  manifestSha256: sha256(CAPABILITY_CATALOG_SQL),
});

const CAPABILITY_OVERRIDES_SQL = `CREATE TABLE vnext_control_plane.vnext_capability_overrides (
  override_id text COLLATE "C" PRIMARY KEY CHECK (btrim(override_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  capability_id text COLLATE "C" NOT NULL CHECK (btrim(capability_id) <> ''),
  effect text COLLATE "C" NOT NULL CHECK (effect IN ('allow', 'deny')),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  starts_at timestamptz NOT NULL CHECK (starts_at <> 'infinity'::timestamptz AND starts_at <> '-infinity'::timestamptz),
  ends_at timestamptz CHECK (ends_at <> 'infinity'::timestamptz AND ends_at <> '-infinity'::timestamptz),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  CHECK (updated_at >= created_at),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'expired' AND ends_at IS NOT NULL AND revoked_at IS NULL)
  ),
  FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (capability_id) REFERENCES vnext_control_plane.vnext_capability_catalog(capability_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX vnext_capability_overrides_one_active_capability
  ON vnext_control_plane.vnext_capability_overrides (authority_id, account_id, capability_id)
  WHERE status = 'active';
GRANT SELECT ON TABLE vnext_control_plane.vnext_capability_overrides TO vnext_pg17_verifier;`;

const CAPABILITY_OVERRIDES_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-capability-overrides-5',
  semanticVersion: 5,
  sql: CAPABILITY_OVERRIDES_SQL,
  manifestSha256: sha256(CAPABILITY_OVERRIDES_SQL),
});

const DATA_SCOPE_GRANTS_SQL = `CREATE TABLE vnext_control_plane.vnext_data_scope_grants (
  scope_grant_id text COLLATE "C" PRIMARY KEY CHECK (btrim(scope_grant_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  scope_type text COLLATE "C" NOT NULL CHECK (scope_type IN ('teacher_profile', 'student_profile', 'school', 'household', 'resource_owner')),
  scope_value_hash text COLLATE "C" NOT NULL CHECK (btrim(scope_value_hash) <> ''),
  effect text COLLATE "C" NOT NULL CHECK (effect IN ('allow', 'deny')),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  starts_at timestamptz NOT NULL CHECK (starts_at <> 'infinity'::timestamptz AND starts_at <> '-infinity'::timestamptz),
  ends_at timestamptz CHECK (ends_at <> 'infinity'::timestamptz AND ends_at <> '-infinity'::timestamptz),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  CHECK (updated_at >= created_at),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'expired' AND ends_at IS NOT NULL AND revoked_at IS NULL)
  ),
  FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX vnext_data_scope_grants_one_active_scope
  ON vnext_control_plane.vnext_data_scope_grants (authority_id, account_id, scope_type, scope_value_hash)
  WHERE status = 'active';
GRANT SELECT ON TABLE vnext_control_plane.vnext_data_scope_grants TO vnext_pg17_verifier;`;

const DATA_SCOPE_GRANTS_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-data-scope-grants-6',
  semanticVersion: 6,
  sql: DATA_SCOPE_GRANTS_SQL,
  manifestSha256: sha256(DATA_SCOPE_GRANTS_SQL),
});

const MIGRATIONS = Object.freeze([
  FIRST_MIGRATION,
  FOUNDATION_IDENTITY_DEVICE_MIGRATION,
  ROLE_GRANTS_MIGRATION,
  CAPABILITY_CATALOG_MIGRATION,
  CAPABILITY_OVERRIDES_MIGRATION,
  DATA_SCOPE_GRANTS_MIGRATION,
]);

const FUNCTION_DEFINITION_SHA256 = Object.freeze({
  vnext_schema_migrations_insert_guard: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_schema_migrations_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE expected_version bigint;
BEGIN
  SELECT COALESCE(MAX(semantic_version), 0) + 1
    INTO expected_version
    FROM vnext_control_plane.vnext_schema_migrations;
  IF NEW.semantic_version <> expected_version THEN
    RAISE EXCEPTION 'vNext schema migration semantic version is not contiguous' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$
`),
  vnext_schema_migrations_no_delete: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_schema_migrations_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext schema migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
  vnext_schema_migrations_no_update: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_schema_migrations_no_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext schema migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
});

const expectedCatalog = Object.freeze({
  schema: 'vnext_control_plane',
  relations: Object.freeze([
    'vnext_control_plane.vnext_account_device_links',
    'vnext_control_plane.vnext_accounts',
    'vnext_control_plane.vnext_authorities',
    'vnext_control_plane.vnext_capability_catalog',
    'vnext_control_plane.vnext_capability_overrides',
    'vnext_control_plane.vnext_data_scope_grants',
    'vnext_control_plane.vnext_device_installations',
    'vnext_control_plane.vnext_role_grants',
    'vnext_control_plane.vnext_schema_meta',
    'vnext_control_plane.vnext_schema_migrations',
    'vnext_control_plane.vnext_trusted_devices',
  ]),
  triggers: Object.freeze([
    'vnext_schema_migrations_insert_guard',
    'vnext_schema_migrations_no_delete',
    'vnext_schema_migrations_no_update',
  ]),
  owners: Object.freeze({ database: 'vnext_pg17_owner', schema: 'vnext_pg17_owner', table: 'vnext_pg17_owner' }),
  functionDefinitionSha256: FUNCTION_DEFINITION_SHA256,
});

module.exports = {
  FIRST_MIGRATION,
  FOUNDATION_IDENTITY_DEVICE_MIGRATION,
  ROLE_GRANTS_MIGRATION,
  CAPABILITY_CATALOG_MIGRATION,
  CAPABILITY_OVERRIDES_MIGRATION,
  DATA_SCOPE_GRANTS_MIGRATION,
  MIGRATIONS,
  expectedCatalog,
  sha256,
};
