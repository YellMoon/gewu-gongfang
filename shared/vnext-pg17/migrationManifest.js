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
  relations: Object.freeze(['vnext_control_plane.vnext_schema_migrations']),
  triggers: Object.freeze([
    'vnext_schema_migrations_insert_guard',
    'vnext_schema_migrations_no_delete',
    'vnext_schema_migrations_no_update',
  ]),
  owners: Object.freeze({ database: 'vnext_pg17_owner', schema: 'vnext_pg17_owner', table: 'vnext_pg17_owner' }),
  functionDefinitionSha256: FUNCTION_DEFINITION_SHA256,
});

module.exports = { FIRST_MIGRATION, expectedCatalog, sha256 };
