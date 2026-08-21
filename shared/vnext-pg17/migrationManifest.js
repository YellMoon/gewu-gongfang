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

const PROFILE_BINDINGS_SQL = `CREATE TABLE vnext_control_plane.vnext_profile_bindings (
  binding_id text COLLATE "C" PRIMARY KEY CHECK (btrim(binding_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  profile_type text COLLATE "C" NOT NULL CHECK (profile_type IN ('teacher', 'student')),
  profile_id text COLLATE "C" NOT NULL CHECK (btrim(profile_id) <> ''),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'revoked', 'pending')),
  evidence_hash text COLLATE "C" NOT NULL CHECK (btrim(evidence_hash) <> ''),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status IN ('active', 'pending') AND revoked_at IS NULL)),
  FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX vnext_profile_bindings_one_active_account_type
  ON vnext_control_plane.vnext_profile_bindings (authority_id, account_id, profile_type)
  WHERE status = 'active';
CREATE UNIQUE INDEX vnext_profile_bindings_one_active_profile
  ON vnext_control_plane.vnext_profile_bindings (authority_id, profile_type, profile_id)
  WHERE status = 'active';
GRANT SELECT ON TABLE vnext_control_plane.vnext_profile_bindings TO vnext_pg17_verifier;`;

const PROFILE_BINDINGS_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-profile-bindings-7',
  semanticVersion: 7,
  sql: PROFILE_BINDINGS_SQL,
  manifestSha256: sha256(PROFILE_BINDINGS_SQL),
});

const VERIFIED_CONTACTS_SQL = `CREATE TABLE vnext_control_plane.vnext_verified_contacts (
  contact_id text COLLATE "C" PRIMARY KEY CHECK (btrim(contact_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  contact_type text COLLATE "C" NOT NULL CHECK (contact_type IN ('phone', 'wechat_openid', 'wechat_unionid')),
  normalized_value_hash text COLLATE "C" NOT NULL CHECK (btrim(normalized_value_hash) <> ''),
  verification_state text COLLATE "C" NOT NULL CHECK (verification_state IN ('verified', 'revoked')),
  verification_evidence_hash text COLLATE "C" NOT NULL CHECK (btrim(verification_evidence_hash) <> ''),
  verified_at timestamptz CHECK (verified_at <> 'infinity'::timestamptz AND verified_at <> '-infinity'::timestamptz),
  revoked_at timestamptz CHECK (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz),
  row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  CHECK (updated_at >= created_at),
  CHECK ((verification_state = 'verified' AND verified_at IS NOT NULL AND revoked_at IS NULL) OR (verification_state = 'revoked' AND verified_at IS NOT NULL AND revoked_at IS NOT NULL)),
  UNIQUE (authority_id, contact_type, normalized_value_hash),
  FOREIGN KEY (account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
GRANT SELECT ON TABLE vnext_control_plane.vnext_verified_contacts TO vnext_pg17_verifier;`;

const VERIFIED_CONTACTS_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-verified-contacts-8',
  semanticVersion: 8,
  sql: VERIFIED_CONTACTS_SQL,
  manifestSha256: sha256(VERIFIED_CONTACTS_SQL),
});

const AUTHORIZATION_COMMAND_RECEIPTS_SQL = `CREATE TABLE vnext_control_plane.vnext_authorization_command_receipts (
  receipt_id text COLLATE "C" PRIMARY KEY CHECK (btrim(receipt_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  actor_key text COLLATE "C" NOT NULL CHECK (btrim(actor_key) <> ''),
  actor_account_id text COLLATE "C" CHECK (actor_account_id IS NULL OR btrim(actor_account_id) <> ''),
  idempotency_key text COLLATE "C" NOT NULL CHECK (btrim(idempotency_key) <> ''),
  command_type text COLLATE "C" NOT NULL CHECK (btrim(command_type) <> ''),
  target_kind text COLLATE "C" NOT NULL CHECK (btrim(target_kind) <> ''),
  target_id text COLLATE "C" NOT NULL CHECK (btrim(target_id) <> ''),
  canonical_request_sha256 text COLLATE "C" NOT NULL CHECK (canonical_request_sha256 ~ '^[0-9a-f]{64}$'),
  expected_row_version bigint CHECK (expected_row_version IS NULL OR expected_row_version >= 0),
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'noop')),
  result_code text COLLATE "C" NOT NULL CHECK (btrim(result_code) <> ''),
  canonical_result_json text COLLATE "C" NOT NULL CHECK (canonical_result_json IS JSON WITH UNIQUE KEYS),
  canonical_result_sha256 text COLLATE "C" NOT NULL CHECK (canonical_result_sha256 ~ '^[0-9a-f]{64}$'),
  committed_auth_version bigint CHECK (committed_auth_version IS NULL OR committed_auth_version >= 1),
  committed_access_version bigint CHECK (committed_access_version IS NULL OR committed_access_version >= 1),
  committed_revocation_version bigint CHECK (committed_revocation_version IS NULL OR committed_revocation_version >= 1),
  committed_target_row_version bigint CHECK (committed_target_row_version IS NULL OR committed_target_row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  UNIQUE (receipt_id, authority_id),
  UNIQUE (authority_id, actor_key, idempotency_key),
  FOREIGN KEY (authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (actor_account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'vNext authorization command receipt is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'vNext authorization command receipt is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER vnext_authorization_command_receipts_no_update
BEFORE UPDATE ON vnext_control_plane.vnext_authorization_command_receipts
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update();
CREATE TRIGGER vnext_authorization_command_receipts_no_delete
BEFORE DELETE ON vnext_control_plane.vnext_authorization_command_receipts
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_delete() FROM PUBLIC;
GRANT SELECT ON TABLE vnext_control_plane.vnext_authorization_command_receipts TO vnext_pg17_verifier;`;

const AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-authorization-command-receipts-9',
  semanticVersion: 9,
  sql: AUTHORIZATION_COMMAND_RECEIPTS_SQL,
  manifestSha256: sha256(AUTHORIZATION_COMMAND_RECEIPTS_SQL),
});

const AUTHORIZATION_AUDIT_EVENTS_SQL = `CREATE TABLE vnext_control_plane.vnext_authorization_audit_events (
  event_id text COLLATE "C" PRIMARY KEY CHECK (btrim(event_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  receipt_id text COLLATE "C" NOT NULL CHECK (btrim(receipt_id) <> ''),
  reason_code text COLLATE "C" NOT NULL CHECK (btrim(reason_code) <> ''),
  context_sha256 text COLLATE "C" NOT NULL CHECK (context_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  UNIQUE(authority_id, receipt_id),
  FOREIGN KEY(authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'vNext authorization audit event is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'vNext authorization audit event is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER vnext_authorization_audit_events_no_update
BEFORE UPDATE ON vnext_control_plane.vnext_authorization_audit_events
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update();
CREATE TRIGGER vnext_authorization_audit_events_no_delete
BEFORE DELETE ON vnext_control_plane.vnext_authorization_audit_events
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_delete() FROM PUBLIC;
GRANT SELECT ON TABLE vnext_control_plane.vnext_authorization_audit_events TO vnext_pg17_verifier;`;

const AUTHORIZATION_AUDIT_EVENTS_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-authorization-audit-events-10',
  semanticVersion: 10,
  sql: AUTHORIZATION_AUDIT_EVENTS_SQL,
  manifestSha256: sha256(AUTHORIZATION_AUDIT_EVENTS_SQL),
});

const AUTHORIZATION_OUTBOX_EVENTS_SQL = `CREATE TABLE vnext_control_plane.vnext_authorization_outbox_events (
  event_id text COLLATE "C" PRIMARY KEY CHECK (btrim(event_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  receipt_id text COLLATE "C" NOT NULL CHECK (btrim(receipt_id) <> ''),
  event_type text COLLATE "C" NOT NULL CHECK (btrim(event_type) <> ''),
  aggregate_kind text COLLATE "C" NOT NULL CHECK (btrim(aggregate_kind) <> ''),
  aggregate_id text COLLATE "C" NOT NULL CHECK (btrim(aggregate_id) <> ''),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  canonical_payload_json text COLLATE "C" NOT NULL CHECK (canonical_payload_json IS JSON WITH UNIQUE KEYS),
  payload_sha256 text COLLATE "C" NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL CHECK (occurred_at <> 'infinity'::timestamptz AND occurred_at <> '-infinity'::timestamptz),
  UNIQUE(authority_id, receipt_id, event_type, aggregate_kind, aggregate_id),
  FOREIGN KEY(authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'vNext authorization outbox event is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'vNext authorization outbox event is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER vnext_authorization_outbox_events_no_update
BEFORE UPDATE ON vnext_control_plane.vnext_authorization_outbox_events
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update();
CREATE TRIGGER vnext_authorization_outbox_events_no_delete
BEFORE DELETE ON vnext_control_plane.vnext_authorization_outbox_events
FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_delete() FROM PUBLIC;
GRANT SELECT ON TABLE vnext_control_plane.vnext_authorization_outbox_events TO vnext_pg17_verifier;`;

const AUTHORIZATION_OUTBOX_EVENTS_MIGRATION = Object.freeze({
  migrationId: 'vnext-pg17-authorization-outbox-events-11',
  semanticVersion: 11,
  sql: AUTHORIZATION_OUTBOX_EVENTS_SQL,
  manifestSha256: sha256(AUTHORIZATION_OUTBOX_EVENTS_SQL),
});

const BOOTSTRAP_CONSUMPTIONS_SQL = `CREATE TABLE vnext_control_plane.vnext_bootstrap_consumptions (
  marker_key text COLLATE "C" PRIMARY KEY CHECK (marker_key = 'single-authority-bootstrap'),
  bootstrap_intent_id text COLLATE "C" NOT NULL UNIQUE CHECK (btrim(bootstrap_intent_id) <> ''),
  authority_id text COLLATE "C" NOT NULL UNIQUE CHECK (btrim(authority_id) <> ''),
  installation_key_fingerprint text COLLATE "C" NOT NULL CHECK (installation_key_fingerprint ~ '^[0-9a-f]{64}$'),
  policy_manifest_sha256 text COLLATE "C" NOT NULL CHECK (policy_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_id text COLLATE "C" NOT NULL UNIQUE CHECK (btrim(receipt_id) <> ''),
  consumed_at timestamptz NOT NULL CHECK (consumed_at <> 'infinity'::timestamptz AND consumed_at <> '-infinity'::timestamptz)
);
CREATE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_authorization_command_receipts r WHERE r.receipt_id=NEW.receipt_id AND r.authority_id=NEW.authority_id AND r.actor_key='bootstrap:' || NEW.bootstrap_intent_id AND r.actor_account_id IS NULL AND r.command_type='authority.bootstrap' AND r.target_kind='authority' AND r.target_id=NEW.authority_id AND r.outcome='accepted' AND r.result_code='AUTHORITY_BOOTSTRAPPED' AND r.expected_row_version=0 AND r.committed_target_row_version=1 AND r.committed_auth_version IS NULL AND r.committed_access_version IS NULL AND r.committed_revocation_version IS NULL AND NEW.consumed_at>=r.created_at AND json_typeof(r.canonical_result_json::json)='object' AND (SELECT count(*) FROM json_object_keys(r.canonical_result_json::json))=7 AND json_typeof(r.canonical_result_json::json->'authorityId')='string' AND json_typeof(r.canonical_result_json::json->'code')='string' AND json_typeof(r.canonical_result_json::json->'policyContractVersion')='number' AND json_typeof(r.canonical_result_json::json->'policyManifestSha256')='string' AND json_typeof(r.canonical_result_json::json->'policyRevision')='number' AND json_typeof(r.canonical_result_json::json->'publicationId')='string' AND json_typeof(r.canonical_result_json::json->'status')='string' AND r.canonical_result_json::json->>'authorityId'=NEW.authority_id AND r.canonical_result_json::json->>'code'='AUTHORITY_BOOTSTRAPPED' AND r.canonical_result_json::json->>'policyContractVersion'='1' AND r.canonical_result_json::json->>'policyManifestSha256'=NEW.policy_manifest_sha256 AND r.canonical_result_json::json->>'policyRevision'='1' AND r.canonical_result_json::json->>'status'='accepted') THEN RAISE EXCEPTION 'VNEXT_BOOTSTRAP_MARKER_RECEIPT_INVALID' USING ERRCODE='P0001'; END IF; RETURN NEW; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext bootstrap consumption is append-only' USING ERRCODE='P0001'; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext bootstrap consumption is append-only' USING ERRCODE='P0001'; END; $$;
CREATE TRIGGER vnext_bootstrap_consumptions_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_bootstrap_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_insert_guard();
CREATE TRIGGER vnext_bootstrap_consumptions_no_update BEFORE UPDATE ON vnext_control_plane.vnext_bootstrap_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_update();
CREATE TRIGGER vnext_bootstrap_consumptions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_bootstrap_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_bootstrap_consumptions_no_delete() FROM PUBLIC;
GRANT SELECT ON TABLE vnext_control_plane.vnext_bootstrap_consumptions TO vnext_pg17_verifier;`;

const BOOTSTRAP_CONSUMPTIONS_MIGRATION = Object.freeze({ migrationId: 'vnext-pg17-bootstrap-consumptions-12', semanticVersion: 12, sql: BOOTSTRAP_CONSUMPTIONS_SQL, manifestSha256: sha256(BOOTSTRAP_CONSUMPTIONS_SQL) });

const AUTHORIZATION_POLICY_PUBLICATIONS_SQL = `CREATE TABLE vnext_control_plane.vnext_authorization_policy_publications (
  publication_id text COLLATE "C" PRIMARY KEY CHECK (btrim(publication_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  receipt_id text COLLATE "C" NOT NULL CHECK (btrim(receipt_id) <> ''),
  policy_revision bigint NOT NULL CHECK (policy_revision >= 1),
  policy_contract_version bigint NOT NULL CHECK (policy_contract_version = 1),
  canonical_manifest_json text COLLATE "C" NOT NULL CHECK (canonical_manifest_json IS JSON OBJECT WITH UNIQUE KEYS),
  policy_manifest_sha256 text COLLATE "C" NOT NULL CHECK (policy_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL CHECK (published_at <> 'infinity'::timestamptz AND published_at <> '-infinity'::timestamptz),
  UNIQUE(authority_id, policy_revision),
  UNIQUE(authority_id, receipt_id),
  FOREIGN KEY(authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.policy_revision <> COALESCE((SELECT MAX(policy_revision) FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id = NEW.authority_id), 0) + 1 THEN
    RAISE EXCEPTION 'VNEXT_POLICY_REVISION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM vnext_control_plane.vnext_authorization_policy_publications WHERE authority_id = NEW.authority_id AND policy_revision = NEW.policy_revision - 1 AND policy_contract_version = NEW.policy_contract_version AND policy_manifest_sha256 = NEW.policy_manifest_sha256) THEN
    RAISE EXCEPTION 'VNEXT_POLICY_UNCHANGED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM vnext_control_plane.vnext_authorization_command_receipts r
      JOIN vnext_control_plane.vnext_authorities a ON a.authority_id = r.authority_id
     WHERE r.receipt_id = NEW.receipt_id
       AND r.authority_id = NEW.authority_id
       AND a.status = 'active'
       AND r.outcome = 'accepted'
       AND r.committed_auth_version IS NULL
       AND r.committed_access_version IS NULL
       AND r.committed_revocation_version IS NULL
       AND NEW.published_at >= r.created_at
       AND json_typeof(r.canonical_result_json::json) = 'object'
       AND (SELECT count(*) FROM json_object_keys(r.canonical_result_json::json)) = 7
       AND json_typeof(r.canonical_result_json::json->'authorityId') = 'string'
       AND json_typeof(r.canonical_result_json::json->'code') = 'string'
       AND json_typeof(r.canonical_result_json::json->'policyContractVersion') = 'number'
       AND json_typeof(r.canonical_result_json::json->'policyManifestSha256') = 'string'
       AND json_typeof(r.canonical_result_json::json->'policyRevision') = 'number'
       AND json_typeof(r.canonical_result_json::json->'publicationId') = 'string'
       AND json_typeof(r.canonical_result_json::json->'status') = 'string'
       AND r.canonical_result_json::json->>'authorityId' = NEW.authority_id
       AND r.canonical_result_json::json->>'policyContractVersion' = NEW.policy_contract_version::text
       AND r.canonical_result_json::json->>'policyManifestSha256' = NEW.policy_manifest_sha256
       AND r.canonical_result_json::json->>'policyRevision' = NEW.policy_revision::text
       AND r.canonical_result_json::json->>'publicationId' = NEW.publication_id
       AND r.canonical_result_json::json->>'status' = 'accepted'
       AND (
         (r.result_code = 'POLICY_PUBLISHED'
          AND r.command_type = 'authorization_policy.publish'
          AND r.target_kind = 'authorization_policy'
          AND r.target_id = NEW.authority_id
          AND r.expected_row_version = NEW.policy_revision - 1
          AND r.committed_target_row_version = NEW.policy_revision
          AND r.canonical_result_json::json->>'code' = 'POLICY_PUBLISHED')
         OR
         (r.result_code = 'AUTHORITY_BOOTSTRAPPED'
          AND r.command_type = 'authority.bootstrap'
          AND r.target_kind = 'authority'
          AND r.target_id = NEW.authority_id
          AND r.actor_account_id IS NULL
          AND r.expected_row_version = 0
          AND r.committed_target_row_version = 1
          AND NEW.policy_revision = 1
          AND r.canonical_result_json::json->>'code' = 'AUTHORITY_BOOTSTRAPPED'
          AND EXISTS (SELECT 1 FROM vnext_control_plane.vnext_bootstrap_consumptions m WHERE m.receipt_id = r.receipt_id AND m.authority_id = NEW.authority_id AND m.policy_manifest_sha256 = NEW.policy_manifest_sha256 AND r.actor_key = 'bootstrap:' || m.bootstrap_intent_id AND NEW.published_at >= m.consumed_at))
       )
  ) THEN
    RAISE EXCEPTION 'VNEXT_POLICY_PUBLICATION_RECEIPT_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext policy publication is append-only' USING ERRCODE = 'P0001'; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext policy publication is append-only' USING ERRCODE = 'P0001'; END; $$;
CREATE TRIGGER vnext_authorization_policy_publications_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_insert_guard();
CREATE TRIGGER vnext_authorization_policy_publications_no_update BEFORE UPDATE ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update();
CREATE TRIGGER vnext_authorization_policy_publications_no_delete BEFORE DELETE ON vnext_control_plane.vnext_authorization_policy_publications FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_policy_publications_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_authorization_policy_publications_no_delete() FROM PUBLIC;
GRANT SELECT ON TABLE vnext_control_plane.vnext_authorization_policy_publications TO vnext_pg17_verifier;`;

const AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION = Object.freeze({ migrationId: 'vnext-pg17-authorization-policy-publications-13', semanticVersion: 13, sql: AUTHORIZATION_POLICY_PUBLICATIONS_SQL, manifestSha256: sha256(AUTHORIZATION_POLICY_PUBLICATIONS_SQL) });

const TRUST_ROOT_EVIDENCE_SQL = `CREATE TABLE vnext_control_plane.vnext_trust_root_evidence (
  evidence_id text COLLATE "C" PRIMARY KEY CHECK (btrim(evidence_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  receipt_id text COLLATE "C" NOT NULL CHECK (btrim(receipt_id) <> ''),
  actor_kind text COLLATE "C" NOT NULL CHECK (actor_kind IN ('deployment_bootstrap', 'owner_recovery_event')),
  event_id text COLLATE "C" NOT NULL CHECK (btrim(event_id) <> ''),
  assertion_evidence_sha256 text COLLATE "C" NOT NULL CHECK (assertion_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  backup_id text COLLATE "C",
  backup_manifest_sha256 text COLLATE "C" CHECK (backup_manifest_sha256 IS NULL OR backup_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  UNIQUE(authority_id, receipt_id),
  UNIQUE(actor_kind, event_id),
  FOREIGN KEY(authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK ((actor_kind = 'deployment_bootstrap' AND backup_id IS NULL AND backup_manifest_sha256 IS NULL) OR (actor_kind = 'owner_recovery_event' AND backup_id IS NOT NULL AND btrim(backup_id) <> '' AND backup_manifest_sha256 IS NOT NULL))
);
CREATE FUNCTION vnext_control_plane.vnext_trust_root_evidence_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.actor_kind = 'deployment_bootstrap' THEN
    IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_bootstrap_consumptions m WHERE m.authority_id = NEW.authority_id AND m.bootstrap_intent_id = NEW.event_id AND m.receipt_id = NEW.receipt_id AND NEW.created_at >= m.consumed_at) THEN
      RAISE EXCEPTION 'VNEXT_TRUST_ROOT_EVIDENCE_RECEIPT_INVALID' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.actor_kind = 'owner_recovery_event' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM vnext_control_plane.vnext_authorization_command_receipts r
       WHERE r.receipt_id = NEW.receipt_id
         AND r.authority_id = NEW.authority_id
         AND r.actor_key = 'recovery:' || NEW.event_id
         AND r.actor_account_id IS NULL
         AND r.command_type = 'authority.owner_recover'
         AND r.target_kind = 'authority'
         AND r.target_id = NEW.authority_id
         AND r.outcome = 'accepted'
         AND r.result_code = 'OWNER_RECOVERY_COMPLETED'
         AND r.expected_row_version IS NULL
         AND r.committed_target_row_version IS NULL
         AND r.committed_auth_version IS NULL
         AND r.committed_access_version IS NULL
         AND r.committed_revocation_version IS NULL
         AND NEW.created_at >= r.created_at
         AND json_typeof(r.canonical_result_json::json) = 'object'
         AND (SELECT count(*) FROM json_object_keys(r.canonical_result_json::json)) = 4
         AND json_typeof(r.canonical_result_json::json->'authorityId') = 'string'
         AND json_typeof(r.canonical_result_json::json->'code') = 'string'
         AND json_typeof(r.canonical_result_json::json->'replacementAccountId') = 'string'
         AND json_typeof(r.canonical_result_json::json->'status') = 'string'
         AND r.canonical_result_json::json->>'authorityId' = NEW.authority_id
         AND r.canonical_result_json::json->>'code' = 'OWNER_RECOVERY_COMPLETED'
         AND r.canonical_result_json::json->>'status' = 'accepted'
    ) THEN
      RAISE EXCEPTION 'VNEXT_TRUST_ROOT_EVIDENCE_RECEIPT_INVALID' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'VNEXT_TRUST_ROOT_EVIDENCE_RECEIPT_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext trust-root evidence is append-only' USING ERRCODE = 'P0001'; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext trust-root evidence is append-only' USING ERRCODE = 'P0001'; END; $$;
CREATE TRIGGER vnext_trust_root_evidence_insert_guard BEFORE INSERT ON vnext_control_plane.vnext_trust_root_evidence FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_trust_root_evidence_insert_guard();
CREATE TRIGGER vnext_trust_root_evidence_no_update BEFORE UPDATE ON vnext_control_plane.vnext_trust_root_evidence FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_update();
CREATE TRIGGER vnext_trust_root_evidence_no_delete BEFORE DELETE ON vnext_control_plane.vnext_trust_root_evidence FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_trust_root_evidence_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_trust_root_evidence_no_delete() FROM PUBLIC;
GRANT SELECT ON TABLE vnext_control_plane.vnext_trust_root_evidence TO vnext_pg17_verifier;`;

const TRUST_ROOT_EVIDENCE_MIGRATION = Object.freeze({ migrationId: 'vnext-pg17-trust-root-evidence-14', semanticVersion: 14, sql: TRUST_ROOT_EVIDENCE_SQL, manifestSha256: sha256(TRUST_ROOT_EVIDENCE_SQL) });

const SESSIONS_REAUTHENTICATION_SQL = `CREATE TABLE vnext_control_plane.vnext_sessions (
  session_id text COLLATE "C" PRIMARY KEY CHECK (btrim(session_id) <> ''), authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''), account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''), device_id text COLLATE "C" NOT NULL CHECK (btrim(device_id) <> ''), installation_id text COLLATE "C" NOT NULL CHECK (btrim(installation_id) <> ''), link_id text COLLATE "C" NOT NULL CHECK (btrim(link_id) <> ''),
  session_kind text COLLATE "C" NOT NULL CHECK (session_kind IN ('online','initialization')), status text COLLATE "C" NOT NULL CHECK (status IN ('active','revoked','expired')),
  issued_at timestamptz NOT NULL CHECK (issued_at <> 'infinity'::timestamptz AND issued_at <> '-infinity'::timestamptz), expires_at timestamptz NOT NULL CHECK (expires_at <> 'infinity'::timestamptz AND expires_at <> '-infinity'::timestamptz), revoked_at timestamptz CHECK (revoked_at IS NULL OR (revoked_at <> 'infinity'::timestamptz AND revoked_at <> '-infinity'::timestamptz)),
  account_auth_version bigint NOT NULL CHECK (account_auth_version >= 1), account_access_version bigint NOT NULL CHECK (account_access_version >= 1), account_revocation_version bigint NOT NULL CHECK (account_revocation_version >= 1), device_credential_version bigint NOT NULL CHECK (device_credential_version >= 1), device_risk_version bigint NOT NULL CHECK (device_risk_version >= 1), installation_credential_version bigint NOT NULL CHECK (installation_credential_version >= 1), link_auth_version bigint NOT NULL CHECK (link_auth_version >= 1), link_access_version bigint NOT NULL CHECK (link_access_version >= 1), link_row_version bigint NOT NULL CHECK (link_row_version >= 1), row_version bigint NOT NULL CHECK (row_version >= 1),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz), updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz),
  UNIQUE(session_id, authority_id), CHECK (expires_at > issued_at), CHECK (updated_at >= created_at), CHECK (revoked_at IS NULL OR revoked_at >= issued_at), CHECK ((status='revoked' AND revoked_at IS NOT NULL) OR (status IN ('active','expired') AND revoked_at IS NULL)),
  FOREIGN KEY(account_id,authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id,authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT, FOREIGN KEY(device_id,authority_id) REFERENCES vnext_control_plane.vnext_trusted_devices(device_id,authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT, FOREIGN KEY(installation_id,device_id,authority_id) REFERENCES vnext_control_plane.vnext_device_installations(installation_id,device_id,authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT, FOREIGN KEY(link_id,authority_id,account_id,device_id,installation_id) REFERENCES vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION vnext_control_plane.vnext_sessions_parent_state_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_authorities au JOIN vnext_control_plane.vnext_accounts a ON a.authority_id=au.authority_id JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=au.authority_id JOIN vnext_control_plane.vnext_device_installations i ON i.authority_id=au.authority_id AND i.device_id=d.device_id JOIN vnext_control_plane.vnext_account_device_links l ON l.authority_id=au.authority_id AND l.account_id=a.account_id AND l.device_id=d.device_id AND l.installation_id=i.installation_id WHERE au.authority_id=NEW.authority_id AND au.status='active' AND a.account_id=NEW.account_id AND a.status='active' AND d.device_id=NEW.device_id AND d.status='active' AND i.installation_id=NEW.installation_id AND i.status='active' AND l.link_id=NEW.link_id AND l.status='active' AND NEW.account_auth_version=a.auth_version AND NEW.account_access_version=a.access_version AND NEW.account_revocation_version=a.revocation_version AND NEW.device_credential_version=d.credential_version AND NEW.device_risk_version=d.risk_version AND NEW.installation_credential_version=i.credential_version AND NEW.link_auth_version=l.auth_version AND NEW.link_access_version=l.access_version AND NEW.link_row_version=l.row_version) THEN RAISE EXCEPTION 'VNEXT_SESSION_PARENT_STATE_INVALID' USING ERRCODE='P0001'; END IF; RETURN NEW; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_sessions_identity_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN IF ROW(NEW.session_id,NEW.authority_id,NEW.account_id,NEW.device_id,NEW.installation_id,NEW.link_id,NEW.session_kind,NEW.issued_at,NEW.expires_at,NEW.account_auth_version,NEW.account_access_version,NEW.account_revocation_version,NEW.device_credential_version,NEW.device_risk_version,NEW.installation_credential_version,NEW.link_auth_version,NEW.link_access_version,NEW.link_row_version,NEW.created_at) IS DISTINCT FROM ROW(OLD.session_id,OLD.authority_id,OLD.account_id,OLD.device_id,OLD.installation_id,OLD.link_id,OLD.session_kind,OLD.issued_at,OLD.expires_at,OLD.account_auth_version,OLD.account_access_version,OLD.account_revocation_version,OLD.device_credential_version,OLD.device_risk_version,OLD.installation_credential_version,OLD.link_auth_version,OLD.link_access_version,OLD.link_row_version,OLD.created_at) THEN RAISE EXCEPTION 'vNext session identity is immutable' USING ERRCODE='P0001'; END IF; RETURN NEW; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_sessions_lifecycle_monotonic() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN IF NEW.status IS DISTINCT FROM OLD.status OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.row_version IS DISTINCT FROM OLD.row_version OR NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN IF OLD.status <> 'active' OR NEW.status NOT IN ('revoked','expired') OR NEW.row_version <> OLD.row_version + 1 OR NEW.updated_at <= OLD.updated_at OR (NEW.status='revoked' AND NEW.revoked_at IS NULL) OR (NEW.status='expired' AND NEW.revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'vNext session lifecycle is immutable' USING ERRCODE='P0001'; END IF; END IF; RETURN NEW; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_sessions_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext session is append-only' USING ERRCODE='P0001'; END; $$;
CREATE TRIGGER vnext_sessions_parent_state_match BEFORE INSERT ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_parent_state_match(); CREATE TRIGGER vnext_sessions_identity_immutable BEFORE UPDATE ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_identity_immutable(); CREATE TRIGGER vnext_sessions_lifecycle_monotonic BEFORE UPDATE ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_lifecycle_monotonic(); CREATE TRIGGER vnext_sessions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_sessions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_sessions_no_delete();
CREATE TABLE vnext_control_plane.vnext_recent_reauthentication_events (reauth_event_id text COLLATE "C" PRIMARY KEY CHECK (btrim(reauth_event_id)<>''), authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id)<>''), session_id text COLLATE "C" NOT NULL CHECK (btrim(session_id)<>''), factor_class text COLLATE "C" NOT NULL CHECK (factor_class IN ('password','passkey','verified_contact')), evidence_sha256 text COLLATE "C" NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'), account_auth_version bigint NOT NULL CHECK (account_auth_version>=1), account_access_version bigint NOT NULL CHECK (account_access_version>=1), account_revocation_version bigint NOT NULL CHECK (account_revocation_version>=1), device_credential_version bigint NOT NULL CHECK (device_credential_version>=1), device_risk_version bigint NOT NULL CHECK (device_risk_version>=1), installation_credential_version bigint NOT NULL CHECK (installation_credential_version>=1), link_auth_version bigint NOT NULL CHECK (link_auth_version>=1), link_access_version bigint NOT NULL CHECK (link_access_version>=1), link_row_version bigint NOT NULL CHECK (link_row_version>=1), verified_at timestamptz NOT NULL CHECK (verified_at<>'infinity'::timestamptz AND verified_at<>'-infinity'::timestamptz), expires_at timestamptz NOT NULL CHECK (expires_at<>'infinity'::timestamptz AND expires_at<>'-infinity'::timestamptz), created_at timestamptz NOT NULL CHECK (created_at<>'infinity'::timestamptz AND created_at<>'-infinity'::timestamptz), CHECK(expires_at>verified_at), FOREIGN KEY(session_id,authority_id) REFERENCES vnext_control_plane.vnext_sessions(session_id,authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT);
CREATE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_session_state_match() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_sessions s WHERE s.session_id=NEW.session_id AND s.authority_id=NEW.authority_id AND s.session_kind='online') THEN RAISE EXCEPTION 'VNEXT_REAUTH_ONLINE_SESSION_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_sessions s WHERE s.session_id=NEW.session_id AND s.authority_id=NEW.authority_id AND s.status='active' AND NEW.verified_at>=s.issued_at AND NEW.verified_at<s.expires_at AND NEW.expires_at<=s.expires_at AND ROW(NEW.account_auth_version,NEW.account_access_version,NEW.account_revocation_version,NEW.device_credential_version,NEW.device_risk_version,NEW.installation_credential_version,NEW.link_auth_version,NEW.link_access_version,NEW.link_row_version)=ROW(s.account_auth_version,s.account_access_version,s.account_revocation_version,s.device_credential_version,s.device_risk_version,s.installation_credential_version,s.link_auth_version,s.link_access_version,s.link_row_version)) THEN RAISE EXCEPTION 'VNEXT_REAUTH_SESSION_STATE_INVALID' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_sessions s JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=s.authority_id JOIN vnext_control_plane.vnext_accounts a ON a.authority_id=s.authority_id AND a.account_id=s.account_id JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=s.authority_id AND d.device_id=s.device_id JOIN vnext_control_plane.vnext_device_installations i ON i.authority_id=s.authority_id AND i.device_id=s.device_id AND i.installation_id=s.installation_id JOIN vnext_control_plane.vnext_account_device_links l ON l.authority_id=s.authority_id AND l.account_id=s.account_id AND l.device_id=s.device_id AND l.installation_id=s.installation_id AND l.link_id=s.link_id WHERE s.session_id=NEW.session_id AND s.authority_id=NEW.authority_id AND au.status='active' AND a.status='active' AND d.status='active' AND i.status='active' AND l.status='active' AND ROW(s.account_auth_version,s.account_access_version,s.account_revocation_version,s.device_credential_version,s.device_risk_version,s.installation_credential_version,s.link_auth_version,s.link_access_version,s.link_row_version)=ROW(a.auth_version,a.access_version,a.revocation_version,d.credential_version,d.risk_version,i.credential_version,l.auth_version,l.access_version,l.row_version)) THEN RAISE EXCEPTION 'VNEXT_REAUTH_CURRENT_PARENT_INVALID' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext reauth event is append-only' USING ERRCODE='P0001'; END; $$; CREATE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext reauth event is append-only' USING ERRCODE='P0001'; END; $$;
CREATE TRIGGER vnext_recent_reauthentication_events_session_state_match BEFORE INSERT ON vnext_control_plane.vnext_recent_reauthentication_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_session_state_match(); CREATE TRIGGER vnext_recent_reauthentication_events_no_update BEFORE UPDATE ON vnext_control_plane.vnext_recent_reauthentication_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_update(); CREATE TRIGGER vnext_recent_reauthentication_events_no_delete BEFORE DELETE ON vnext_control_plane.vnext_recent_reauthentication_events FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_delete();
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_sessions_parent_state_match() FROM PUBLIC; REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_sessions_identity_immutable() FROM PUBLIC; REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_sessions_lifecycle_monotonic() FROM PUBLIC; REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_sessions_no_delete() FROM PUBLIC; REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_session_state_match() FROM PUBLIC; REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_update() FROM PUBLIC; REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_recent_reauthentication_events_no_delete() FROM PUBLIC; GRANT SELECT ON TABLE vnext_control_plane.vnext_sessions, vnext_control_plane.vnext_recent_reauthentication_events TO vnext_pg17_verifier;`;
const SESSIONS_REAUTHENTICATION_MIGRATION = Object.freeze({ migrationId: 'vnext-pg17-sessions-reauthentication-15', semanticVersion: 15, sql: SESSIONS_REAUTHENTICATION_SQL, manifestSha256: sha256(SESSIONS_REAUTHENTICATION_SQL) });

const UNIFIED_DESKTOP_ONLINE_REGISTRATION_SQL = `CREATE TABLE vnext_control_plane.vnext_online_identity_assertions (
  assertion_id text COLLATE "C" PRIMARY KEY CHECK (btrim(assertion_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  account_id text COLLATE "C" NOT NULL CHECK (btrim(account_id) <> ''),
  account_auth_version bigint NOT NULL CHECK (account_auth_version >= 1),
  account_access_version bigint NOT NULL CHECK (account_access_version >= 1),
  account_revocation_version bigint NOT NULL CHECK (account_revocation_version >= 1),
  device_id text COLLATE "C" NOT NULL CHECK (btrim(device_id) <> ''),
  installation_id text COLLATE "C" NOT NULL CHECK (btrim(installation_id) <> ''),
  installation_public_key text COLLATE "C" NOT NULL CHECK (btrim(installation_public_key) <> ''),
  key_fingerprint text COLLATE "C" NOT NULL CHECK (key_fingerprint ~ '^[0-9a-f]{64}$'),
  audience text COLLATE "C" NOT NULL CHECK (audience = 'unified-desktop'),
  nonce_sha256 text COLLATE "C" NOT NULL CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_request_sha256 text COLLATE "C" NOT NULL CHECK (canonical_request_sha256 ~ '^[0-9a-f]{64}$'),
  identity_proof_sha256 text COLLATE "C" NOT NULL CHECK (identity_proof_sha256 ~ '^[0-9a-f]{64}$'),
  hardware_evidence_sha256 text COLLATE "C" NOT NULL CHECK (hardware_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL CHECK (issued_at <> 'infinity'::timestamptz AND issued_at <> '-infinity'::timestamptz),
  expires_at timestamptz NOT NULL CHECK (expires_at <> 'infinity'::timestamptz AND expires_at <> '-infinity'::timestamptz),
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  UNIQUE(authority_id, nonce_sha256),
  FOREIGN KEY(account_id, authority_id) REFERENCES vnext_control_plane.vnext_accounts(account_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(authority_id) REFERENCES vnext_control_plane.vnext_authorities(authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK(expires_at > issued_at), CHECK(created_at >= issued_at)
);
CREATE TABLE vnext_control_plane.vnext_online_identity_assertion_consumptions (
  assertion_id text COLLATE "C" PRIMARY KEY CHECK (btrim(assertion_id) <> ''),
  authority_id text COLLATE "C" NOT NULL CHECK (btrim(authority_id) <> ''),
  receipt_id text COLLATE "C" NOT NULL CHECK (btrim(receipt_id) <> ''),
  consumed_at timestamptz NOT NULL CHECK (consumed_at <> 'infinity'::timestamptz AND consumed_at <> '-infinity'::timestamptz),
  FOREIGN KEY(assertion_id) REFERENCES vnext_control_plane.vnext_online_identity_assertions(assertion_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(receipt_id, authority_id) REFERENCES vnext_control_plane.vnext_authorization_command_receipts(receipt_id, authority_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext online identity assertion is append-only' USING ERRCODE='P0001'; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext online identity assertion is append-only' USING ERRCODE='P0001'; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext online identity assertion consumption is append-only' USING ERRCODE='P0001'; END; $$;
CREATE FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'vNext online identity assertion consumption is append-only' USING ERRCODE='P0001'; END; $$;
CREATE TRIGGER vnext_online_identity_assertions_no_update BEFORE UPDATE ON vnext_control_plane.vnext_online_identity_assertions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_update();
CREATE TRIGGER vnext_online_identity_assertions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_online_identity_assertions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_delete();
CREATE TRIGGER vnext_online_identity_assertion_consumptions_no_update BEFORE UPDATE ON vnext_control_plane.vnext_online_identity_assertion_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_update();
CREATE TRIGGER vnext_online_identity_assertion_consumptions_no_delete BEFORE DELETE ON vnext_control_plane.vnext_online_identity_assertion_consumptions FOR EACH ROW EXECUTE FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_delete();
CREATE FUNCTION vnext_control_plane.vnext_issue_online_identity_assertion(p_assertion_id text, p_authority_id text, p_account_id text, p_device_id text, p_installation_id text, p_installation_public_key text, p_key_fingerprint text, p_audience text, p_nonce_sha256 text, p_canonical_request_sha256 text, p_identity_proof_sha256 text, p_hardware_evidence_sha256 text, p_issued_at timestamptz, p_expires_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE now_at timestamptz := transaction_timestamp();
BEGIN
  IF p_issued_at < now_at - interval '5 minutes' OR p_issued_at > now_at OR p_expires_at <= now_at OR p_expires_at > now_at + interval '15 minutes' THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_ASSERTION_INVALID' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_authorities au JOIN vnext_control_plane.vnext_accounts a ON a.authority_id=au.authority_id WHERE au.authority_id=p_authority_id AND au.status='active' AND a.account_id=p_account_id AND a.status='active') THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_ASSERTION_PARENT_INVALID' USING ERRCODE='P0001'; END IF;
  INSERT INTO vnext_control_plane.vnext_online_identity_assertions(assertion_id,authority_id,account_id,account_auth_version,account_access_version,account_revocation_version,device_id,installation_id,installation_public_key,key_fingerprint,audience,nonce_sha256,canonical_request_sha256,identity_proof_sha256,hardware_evidence_sha256,issued_at,expires_at,created_at) SELECT p_assertion_id,p_authority_id,p_account_id,a.auth_version,a.access_version,a.revocation_version,p_device_id,p_installation_id,p_installation_public_key,p_key_fingerprint,p_audience,p_nonce_sha256,p_canonical_request_sha256,p_identity_proof_sha256,p_hardware_evidence_sha256,p_issued_at,p_expires_at,now_at FROM vnext_control_plane.vnext_accounts a WHERE a.authority_id=p_authority_id AND a.account_id=p_account_id AND a.status='active';
END; $$;
CREATE FUNCTION vnext_control_plane.vnext_register_unified_desktop_online(p_assertion_id text, p_idempotency_key text, p_receipt_id text, p_audit_event_id text, p_outbox_event_id text, p_session_id text, p_link_id text, p_session_expires_at timestamptz, p_canonical_result_json text, p_result_sha256 text, p_canonical_payload_json text, p_payload_sha256 text) RETURNS TABLE(receipt_id text, session_id text, replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a vnext_control_plane.vnext_online_identity_assertions%ROWTYPE; au vnext_control_plane.vnext_authorities%ROWTYPE; ac vnext_control_plane.vnext_accounts%ROWTYPE; d vnext_control_plane.vnext_trusted_devices%ROWTYPE; i vnext_control_plane.vnext_device_installations%ROWTYPE; resolved_link vnext_control_plane.vnext_account_device_links%ROWTYPE; existing_receipt vnext_control_plane.vnext_authorization_command_receipts%ROWTYPE; existing_session vnext_control_plane.vnext_sessions%ROWTYPE; now_at timestamptz := transaction_timestamp();
BEGIN
  SELECT * INTO a FROM vnext_control_plane.vnext_online_identity_assertions WHERE assertion_id=p_assertion_id FOR UPDATE;
  IF NOT FOUND OR now_at < a.issued_at OR now_at >= a.expires_at OR p_session_expires_at <= now_at OR p_session_expires_at > now_at + interval '24 hours' THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_ASSERTION_INVALID' USING ERRCODE='P0001'; END IF;
  IF json_typeof(p_canonical_result_json::json) <> 'object' OR (SELECT count(*) FROM json_object_keys(p_canonical_result_json::json)) <> 1 OR json_typeof(p_canonical_result_json::json->'sessionId') <> 'string' OR p_canonical_result_json::json->>'sessionId' <> p_session_id OR json_typeof(p_canonical_payload_json::json) <> 'object' OR (SELECT count(*) FROM json_object_keys(p_canonical_payload_json::json)) <> 1 OR json_typeof(p_canonical_payload_json::json->'sessionId') <> 'string' OR p_canonical_payload_json::json->>'sessionId' <> p_session_id THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_RESULT_INVALID' USING ERRCODE='P0001'; END IF;
  SELECT * INTO au FROM vnext_control_plane.vnext_authorities WHERE authority_id=a.authority_id FOR UPDATE;
  SELECT * INTO ac FROM vnext_control_plane.vnext_accounts WHERE authority_id=a.authority_id AND account_id=a.account_id FOR UPDATE;
  IF NOT FOUND OR au.status <> 'active' OR ac.status <> 'active' OR ac.auth_version <> a.account_auth_version OR ac.access_version <> a.account_access_version OR ac.revocation_version <> a.account_revocation_version THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_PARENT_REVOKED' USING ERRCODE='P0001'; END IF;
  SELECT * INTO existing_receipt FROM vnext_control_plane.vnext_authorization_command_receipts WHERE authority_id=a.authority_id AND actor_key='online-identity:' || a.key_fingerprint AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF existing_receipt.command_type <> 'desktop.online_register' OR existing_receipt.actor_account_id <> a.account_id OR existing_receipt.canonical_request_sha256 <> a.canonical_request_sha256 OR existing_receipt.target_kind <> 'desktop_installation' OR existing_receipt.target_id <> a.installation_id OR existing_receipt.outcome <> 'accepted' OR existing_receipt.result_code <> 'DESKTOP_ONLINE_REGISTERED' OR existing_receipt.expected_row_version <> 0 OR existing_receipt.canonical_result_json <> p_canonical_result_json OR existing_receipt.canonical_result_sha256 <> p_result_sha256 THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
    SELECT s.* INTO existing_session FROM vnext_control_plane.vnext_sessions s WHERE s.session_id=(existing_receipt.canonical_result_json::json ->> 'sessionId') AND s.authority_id=a.authority_id FOR UPDATE;
    SELECT * INTO d FROM vnext_control_plane.vnext_trusted_devices WHERE device_id=a.device_id AND authority_id=a.authority_id FOR UPDATE;
    SELECT * INTO i FROM vnext_control_plane.vnext_device_installations WHERE installation_id=a.installation_id AND authority_id=a.authority_id FOR UPDATE;
    SELECT * INTO resolved_link FROM vnext_control_plane.vnext_account_device_links WHERE link_id=existing_session.link_id AND authority_id=a.authority_id FOR UPDATE;
    IF NOT FOUND OR existing_session.status <> 'active' OR existing_session.expires_at <= now_at OR existing_session.account_id <> a.account_id OR existing_session.device_id <> a.device_id OR existing_session.installation_id <> a.installation_id OR d.status <> 'active' OR d.hardware_evidence_hash <> a.hardware_evidence_sha256 OR i.status <> 'active' OR resolved_link.status <> 'active' OR existing_session.account_auth_version <> ac.auth_version OR existing_session.account_access_version <> ac.access_version OR existing_session.account_revocation_version <> ac.revocation_version OR existing_session.device_credential_version <> d.credential_version OR existing_session.device_risk_version <> d.risk_version OR existing_session.installation_credential_version <> i.credential_version OR existing_session.link_auth_version <> resolved_link.auth_version OR existing_session.link_access_version <> resolved_link.access_version OR existing_session.link_row_version <> resolved_link.row_version THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_PARENT_REVOKED' USING ERRCODE='P0001'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vnext_control_plane.vnext_online_identity_assertion_consumptions c WHERE c.assertion_id=a.assertion_id AND c.receipt_id=existing_receipt.receipt_id) THEN INSERT INTO vnext_control_plane.vnext_online_identity_assertion_consumptions(assertion_id,authority_id,receipt_id,consumed_at) VALUES(a.assertion_id,a.authority_id,existing_receipt.receipt_id,now_at); END IF;
    RETURN QUERY SELECT existing_receipt.receipt_id, existing_session.session_id, true; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM vnext_control_plane.vnext_online_identity_assertion_consumptions WHERE assertion_id=a.assertion_id) THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_ASSERTION_CONSUMED' USING ERRCODE='P0001'; END IF;
  INSERT INTO vnext_control_plane.vnext_trusted_devices(device_id,authority_id,status,hardware_evidence_hash,risk_code,credential_version,risk_version,row_version,created_at,updated_at,revoked_at) VALUES(a.device_id,a.authority_id,'active',a.hardware_evidence_sha256,NULL,1,1,1,now_at,now_at,NULL) ON CONFLICT(device_id) DO NOTHING;
  SELECT * INTO d FROM vnext_control_plane.vnext_trusted_devices WHERE device_id=a.device_id AND authority_id=a.authority_id FOR UPDATE;
  IF NOT FOUND OR d.status <> 'active' OR d.hardware_evidence_hash <> a.hardware_evidence_sha256 THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_DEVICE_CONFLICT' USING ERRCODE='P0001'; END IF;
  INSERT INTO vnext_control_plane.vnext_device_installations(installation_id,authority_id,device_id,installation_public_key,key_fingerprint,status,credential_version,row_version,created_at,updated_at,revoked_at) VALUES(a.installation_id,a.authority_id,a.device_id,a.installation_public_key,a.key_fingerprint,'active',1,1,now_at,now_at,NULL) ON CONFLICT(installation_id) DO NOTHING;
  SELECT * INTO i FROM vnext_control_plane.vnext_device_installations WHERE installation_id=a.installation_id AND authority_id=a.authority_id FOR UPDATE;
  IF NOT FOUND OR i.device_id <> a.device_id OR i.installation_public_key <> a.installation_public_key OR i.key_fingerprint <> a.key_fingerprint OR i.status <> 'active' THEN RAISE EXCEPTION 'VNEXT_ONLINE_IDENTITY_INSTALLATION_CONFLICT' USING ERRCODE='P0001'; END IF;
  SELECT * INTO resolved_link FROM vnext_control_plane.vnext_account_device_links WHERE authority_id=a.authority_id AND account_id=a.account_id AND installation_id=a.installation_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN INSERT INTO vnext_control_plane.vnext_account_device_links(link_id,authority_id,account_id,device_id,installation_id,status,auth_version,access_version,row_version,created_at,updated_at,revoked_at) VALUES(p_link_id,a.authority_id,a.account_id,a.device_id,a.installation_id,'active',1,1,1,now_at,now_at,NULL) RETURNING * INTO resolved_link; END IF;
  INSERT INTO vnext_control_plane.vnext_sessions(session_id,authority_id,account_id,device_id,installation_id,link_id,session_kind,status,issued_at,expires_at,revoked_at,account_auth_version,account_access_version,account_revocation_version,device_credential_version,device_risk_version,installation_credential_version,link_auth_version,link_access_version,link_row_version,row_version,created_at,updated_at) VALUES(p_session_id,a.authority_id,a.account_id,a.device_id,a.installation_id,resolved_link.link_id,'online','active',now_at,p_session_expires_at,NULL,ac.auth_version,ac.access_version,ac.revocation_version,d.credential_version,d.risk_version,i.credential_version,resolved_link.auth_version,resolved_link.access_version,resolved_link.row_version,1,now_at,now_at);
  INSERT INTO vnext_control_plane.vnext_authorization_command_receipts(receipt_id,authority_id,actor_key,actor_account_id,idempotency_key,command_type,target_kind,target_id,canonical_request_sha256,expected_row_version,outcome,result_code,canonical_result_json,canonical_result_sha256,committed_auth_version,committed_access_version,committed_revocation_version,committed_target_row_version,created_at) VALUES(p_receipt_id,a.authority_id,'online-identity:' || a.key_fingerprint,a.account_id,p_idempotency_key,'desktop.online_register','desktop_installation',a.installation_id,a.canonical_request_sha256,0,'accepted','DESKTOP_ONLINE_REGISTERED',p_canonical_result_json,p_result_sha256,ac.auth_version,ac.access_version,ac.revocation_version,resolved_link.row_version,now_at);
  INSERT INTO vnext_control_plane.vnext_authorization_audit_events(event_id,authority_id,receipt_id,reason_code,context_sha256,created_at) VALUES(p_audit_event_id,a.authority_id,p_receipt_id,'DESKTOP_ONLINE_REGISTERED',a.identity_proof_sha256,now_at);
  INSERT INTO vnext_control_plane.vnext_authorization_outbox_events(event_id,authority_id,receipt_id,event_type,aggregate_kind,aggregate_id,aggregate_version,canonical_payload_json,payload_sha256,occurred_at) VALUES(p_outbox_event_id,a.authority_id,p_receipt_id,'desktop.online_registered','desktop_installation',a.installation_id,1,p_canonical_payload_json,p_payload_sha256,now_at);
  INSERT INTO vnext_control_plane.vnext_online_identity_assertion_consumptions(assertion_id,authority_id,receipt_id,consumed_at) VALUES(a.assertion_id,a.authority_id,p_receipt_id,now_at);
  RETURN QUERY SELECT p_receipt_id,p_session_id,false;
END; $$;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_online_identity_assertions_no_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_online_identity_assertion_consumptions_no_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_issue_online_identity_assertion(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_register_unified_desktop_online(text,text,text,text,text,text,text,timestamptz,text,text,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA vnext_control_plane TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_issue_online_identity_assertion(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_register_unified_desktop_online(text,text,text,text,text,text,text,timestamptz,text,text,text,text) TO vnext_pg17_writer;
GRANT SELECT ON TABLE vnext_control_plane.vnext_online_identity_assertions, vnext_control_plane.vnext_online_identity_assertion_consumptions TO vnext_pg17_verifier;`;
const UNIFIED_DESKTOP_ONLINE_REGISTRATION_MIGRATION = Object.freeze({ migrationId: 'vnext-pg17-unified-desktop-online-registration-16', semanticVersion: 16, sql: UNIFIED_DESKTOP_ONLINE_REGISTRATION_SQL, manifestSha256: sha256(UNIFIED_DESKTOP_ONLINE_REGISTRATION_SQL) });

const MIGRATIONS = Object.freeze([
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
  UNIFIED_DESKTOP_ONLINE_REGISTRATION_MIGRATION,
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
  vnext_authorization_command_receipts_no_update: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext authorization command receipt is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
  vnext_authorization_command_receipts_no_delete: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_command_receipts_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext authorization command receipt is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
  vnext_authorization_audit_events_no_update: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext authorization audit event is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
  vnext_authorization_audit_events_no_delete: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_audit_events_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext authorization audit event is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
  vnext_authorization_outbox_events_no_update: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext authorization outbox event is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
  vnext_authorization_outbox_events_no_delete: sha256(`CREATE OR REPLACE FUNCTION vnext_control_plane.vnext_authorization_outbox_events_no_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'vNext authorization outbox event is append-only' USING ERRCODE = 'P0001';
END;
$function$
`),
  vnext_authorization_policy_publications_insert_guard: '7051bdb27fac85b9084fcbb6231394a1734df88a7530c6bcbc3176eff333947d',
  vnext_authorization_policy_publications_no_delete: 'f8bcb509024883e06fa095670d64414f6a5d86af996dad89b01f0346628449b4',
  vnext_authorization_policy_publications_no_update: 'efe409fccc1f4e835f2bea76814a7dcd844ba401fd1c5d33de041cd9984f9cd5',
  vnext_bootstrap_consumptions_insert_guard: '79d847c9285a91fe49a72afb79b2b67dffd8042177df3dde6a9db154fdfe2d82',
  vnext_bootstrap_consumptions_no_delete: '78211e1091e81e3ec8a52b853bc564c07fb1525ba30cdf5c04dd2c8e9a56f2a2',
  vnext_bootstrap_consumptions_no_update: '70eb96f8bb41027dc1ce6aa2ea4665046cc0c52d22a98fc25a57cf91ad5aaf53',
  vnext_trust_root_evidence_insert_guard: '8ede7761a86bf42a64c514fc77c7bfaf4542018643d50b2314b0046b275ef270',
  vnext_trust_root_evidence_no_delete: '7f508cfd2370fef9765de72fba3dc2e7f6cd5d9780defea7837b138cb5d1b045',
  vnext_trust_root_evidence_no_update: '444a1f1d73b28c10c003ef154335fe88c67f2a53bf89d076f83c377b2f405997',
  vnext_recent_reauthentication_events_no_delete: 'e32110fb31f2d25eaa24b0b9892ac3854e09dd031c89dd9f3690dfb463fc38a7',
  vnext_recent_reauthentication_events_no_update: 'a52caaa0a3ef69dae20bb2b375df2a6cabb78e3da077e25748aa42d6c9e6b051',
  vnext_recent_reauthentication_events_session_state_match: '32af04ca45eea7a87903e5e9624bea3eb858d9d94491d72efb8d328f27d98f97',
  vnext_sessions_identity_immutable: '76d9e879b79c11dcdbbc35923fd02aecee9e3872644cc38d84b3f1b94d7caff3',
  vnext_sessions_lifecycle_monotonic: 'd98f01791b5c6e6ab51a3c815334f7055d57c56bd3eb118723dae6be9c7cd7c6',
  vnext_sessions_no_delete: '6b7f632dc9141b0bcc00c44b562d7ee50b8b43dec992fbc80f4a5eca7611070c',
  vnext_sessions_parent_state_match: 'ff2b7ec86eef777566246bd67013efe247706f15b4088ea8dc2025bdc1318cc4',
  vnext_issue_online_identity_assertion: 'b25d146e4ad6cb39cec66eb4253147ff6c5c542b4ff4fc14d1c5d594e1c7d6be',
  vnext_online_identity_assertion_consumptions_no_delete: '373d46bf6da02b2a62dd659aef8780b155240ce80445e07c1f8ebe8be7acbff8',
  vnext_online_identity_assertion_consumptions_no_update: '4ce7a8ffabea8a01ed87a1aaac8689cd603420fbf082ded04e6e9079c918fe7a',
  vnext_online_identity_assertions_no_delete: 'f6eaa89e09943fdc457860c2c890aedd9899acb0cb3d71e40a94a0e066f1c32e',
  vnext_online_identity_assertions_no_update: 'e80dd5dd122a11ddab36726e19a9fa468d4fcb4d65d7587f9a0ebb5d841b9693',
  vnext_register_unified_desktop_online: '921f62d7e5b901738525262cfc4610edbfb52d3f1ab8fca4694a2f728dcae65a',
});

const expectedCatalog = Object.freeze({
  schema: 'vnext_control_plane',
  relations: Object.freeze([
    'vnext_control_plane.vnext_account_device_links',
    'vnext_control_plane.vnext_accounts',
    'vnext_control_plane.vnext_authorities',
    'vnext_control_plane.vnext_authorization_audit_events',
    'vnext_control_plane.vnext_authorization_command_receipts',
    'vnext_control_plane.vnext_authorization_outbox_events',
    'vnext_control_plane.vnext_authorization_policy_publications',
    'vnext_control_plane.vnext_bootstrap_consumptions',
    'vnext_control_plane.vnext_capability_catalog',
    'vnext_control_plane.vnext_capability_overrides',
    'vnext_control_plane.vnext_data_scope_grants',
    'vnext_control_plane.vnext_device_installations',
    'vnext_control_plane.vnext_online_identity_assertion_consumptions',
    'vnext_control_plane.vnext_online_identity_assertions',
    'vnext_control_plane.vnext_profile_bindings',
    'vnext_control_plane.vnext_recent_reauthentication_events',
    'vnext_control_plane.vnext_role_grants',
    'vnext_control_plane.vnext_schema_meta',
    'vnext_control_plane.vnext_schema_migrations',
    'vnext_control_plane.vnext_sessions',
    'vnext_control_plane.vnext_trust_root_evidence',
    'vnext_control_plane.vnext_trusted_devices',
    'vnext_control_plane.vnext_verified_contacts',
  ]),
  triggers: Object.freeze([
    'vnext_schema_migrations_insert_guard',
    'vnext_schema_migrations_no_delete',
    'vnext_schema_migrations_no_update',
    'vnext_authorization_command_receipts_no_delete',
    'vnext_authorization_command_receipts_no_update',
    'vnext_authorization_audit_events_no_delete',
    'vnext_authorization_audit_events_no_update',
    'vnext_authorization_outbox_events_no_delete',
    'vnext_authorization_outbox_events_no_update',
    'vnext_bootstrap_consumptions_insert_guard',
    'vnext_bootstrap_consumptions_no_delete',
    'vnext_bootstrap_consumptions_no_update',
    'vnext_authorization_policy_publications_insert_guard',
    'vnext_authorization_policy_publications_no_delete',
    'vnext_authorization_policy_publications_no_update',
    'vnext_trust_root_evidence_insert_guard',
    'vnext_trust_root_evidence_no_delete',
    'vnext_trust_root_evidence_no_update',
    'vnext_sessions_parent_state_match',
    'vnext_sessions_identity_immutable',
    'vnext_sessions_lifecycle_monotonic',
    'vnext_sessions_no_delete',
    'vnext_recent_reauthentication_events_session_state_match',
    'vnext_recent_reauthentication_events_no_update',
    'vnext_recent_reauthentication_events_no_delete',
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
  PROFILE_BINDINGS_MIGRATION,
  VERIFIED_CONTACTS_MIGRATION,
  AUTHORIZATION_COMMAND_RECEIPTS_MIGRATION,
  AUTHORIZATION_AUDIT_EVENTS_MIGRATION,
  AUTHORIZATION_OUTBOX_EVENTS_MIGRATION,
  BOOTSTRAP_CONSUMPTIONS_MIGRATION,
  AUTHORIZATION_POLICY_PUBLICATIONS_MIGRATION,
  TRUST_ROOT_EVIDENCE_MIGRATION,
  SESSIONS_REAUTHENTICATION_MIGRATION,
  UNIFIED_DESKTOP_ONLINE_REGISTRATION_MIGRATION,
  MIGRATIONS,
  expectedCatalog,
  sha256,
};
