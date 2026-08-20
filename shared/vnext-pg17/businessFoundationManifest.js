'use strict';

const { createHash } = require('crypto');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const BUSINESS_FOUNDATION_SQL = `CREATE SCHEMA business AUTHORIZATION vnext_pg17_business_owner;
REVOKE CREATE ON SCHEMA business FROM PUBLIC;
CREATE TABLE business.business_schema_migrations (
  migration_id text COLLATE "C" PRIMARY KEY CHECK (btrim(migration_id) <> ''),
  semantic_version integer NOT NULL UNIQUE CHECK (semantic_version > 0),
  manifest_sha256 text COLLATE "C" NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL CHECK (applied_at <> 'infinity'::timestamptz AND applied_at <> '-infinity'::timestamptz),
  applied_by text COLLATE "C" NOT NULL CHECK (btrim(applied_by) <> '')
);
CREATE FUNCTION business.business_schema_migrations_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.semantic_version <> COALESCE((SELECT MAX(semantic_version) FROM business.business_schema_migrations), 0) + 1 THEN
    RAISE EXCEPTION 'business migration version must be consecutive' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION business.business_schema_migrations_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'business migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE FUNCTION business.business_schema_migrations_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'business migration ledger is append-only' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER business_schema_migrations_insert_guard BEFORE INSERT ON business.business_schema_migrations FOR EACH ROW EXECUTE FUNCTION business.business_schema_migrations_insert_guard();
CREATE TRIGGER business_schema_migrations_no_update BEFORE UPDATE ON business.business_schema_migrations FOR EACH ROW EXECUTE FUNCTION business.business_schema_migrations_no_update();
CREATE TRIGGER business_schema_migrations_no_delete BEFORE DELETE ON business.business_schema_migrations FOR EACH ROW EXECUTE FUNCTION business.business_schema_migrations_no_delete();
REVOKE EXECUTE ON FUNCTION business.business_schema_migrations_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.business_schema_migrations_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.business_schema_migrations_no_delete() FROM PUBLIC;
CREATE TABLE business.tenants (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  legacy_status text,
  legacy_plan text,
  legacy_archive_before timestamptz CHECK (legacy_archive_before IS NULL OR (legacy_archive_before <> 'infinity'::timestamptz AND legacy_archive_before <> '-infinity'::timestamptz)),
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at)
);
CREATE TABLE business.institutions (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  contact_person_legacy text,
  contact_phone_legacy text,
  revenue_share numeric,
  notes text,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT institutions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX institutions_tenant_id_idx ON business.institutions(tenant_id);
CREATE TABLE business.schools (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  legacy_count integer,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT schools_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX schools_tenant_id_idx ON business.schools(tenant_id);
CREATE TABLE business.rooms (
  id text COLLATE "C" PRIMARY KEY CHECK (btrim(id) <> ''),
  tenant_id text COLLATE "C" NOT NULL CHECK (btrim(tenant_id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  address_legacy text,
  legacy_count integer,
  legacy_deleted boolean NOT NULL,
  created_at timestamptz NOT NULL CHECK (created_at <> 'infinity'::timestamptz AND created_at <> '-infinity'::timestamptz),
  updated_at timestamptz NOT NULL CHECK (updated_at <> 'infinity'::timestamptz AND updated_at <> '-infinity'::timestamptz AND updated_at >= created_at),
  CONSTRAINT rooms_tenant_fk FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX rooms_tenant_id_idx ON business.rooms(tenant_id);
GRANT USAGE ON SCHEMA business TO vnext_pg17_business_verifier;
GRANT SELECT ON TABLE business.business_schema_migrations TO vnext_pg17_business_verifier;
GRANT SELECT (id) ON TABLE business.tenants, business.institutions, business.schools, business.rooms TO vnext_pg17_business_verifier;`;

const EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256 = '050774ac2ccbc84a6ec14e4c65ce83d18fdd75eb7f73114fd55817497d033a75';
const BUSINESS_FOUNDATION_MIGRATIONS = Object.freeze([Object.freeze({
  migrationId: 'business-foundation-1',
  semanticVersion: 1,
  sql: BUSINESS_FOUNDATION_SQL,
  manifestSha256: sha256(BUSINESS_FOUNDATION_SQL),
})]);

const expectedBusinessFoundationCatalog = Object.freeze({
  relations: Object.freeze([
    'business.business_schema_migrations',
    'business.institutions',
    'business.rooms',
    'business.schools',
    'business.tenants',
  ]),
});

module.exports = {
  BUSINESS_FOUNDATION_MIGRATIONS,
  EXPECTED_BUSINESS_FOUNDATION_MANIFEST_SHA256,
  expectedBusinessFoundationCatalog,
  sha256,
};
