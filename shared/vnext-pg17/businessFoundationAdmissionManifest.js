'use strict';

const { createHash } = require('crypto');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const SQL = `CREATE SCHEMA migration_admission AUTHORIZATION vnext_pg17_migration_admission_owner;
REVOKE ALL ON SCHEMA migration_admission FROM PUBLIC;
CREATE TABLE migration_admission.migration_admission_schema_migrations (
  migration_id text COLLATE "C" PRIMARY KEY CHECK (btrim(migration_id) <> ''),
  semantic_version integer NOT NULL UNIQUE CHECK (semantic_version >= 1),
  manifest_sha256 text COLLATE "C" NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL CHECK (applied_at NOT IN ('infinity'::timestamptz, '-infinity'::timestamptz)),
  applied_by text COLLATE "C" NOT NULL CHECK (btrim(applied_by) <> '')
);
CREATE TABLE migration_admission.migration_batches (
  batch_id text COLLATE "C" PRIMARY KEY CHECK (btrim(batch_id) <> ''),
  source_snapshot_sha256 text COLLATE "C" NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_inventory_before_sha256 text COLLATE "C" NOT NULL CHECK (source_inventory_before_sha256 ~ '^[0-9a-f]{64}$'),
  source_inventory_after_sha256 text COLLATE "C" NOT NULL CHECK (source_inventory_after_sha256 ~ '^[0-9a-f]{64}$'),
  source_catalog_sha256 text COLLATE "C" NOT NULL CHECK (source_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  source_contract_sha256 text COLLATE "C" NOT NULL CHECK (source_contract_sha256 ~ '^[0-9a-f]{64}$'),
  source_schema_sha256 text COLLATE "C" NOT NULL CHECK (source_schema_sha256 ~ '^[0-9a-f]{64}$'),
  business_manifest_sha256 text COLLATE "C" NOT NULL CHECK (business_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  mapper_set_sha256 text COLLATE "C" NOT NULL CHECK (mapper_set_sha256 ~ '^[0-9a-f]{64}$'),
  consent_sha256 text COLLATE "C" NOT NULL CHECK (consent_sha256 ~ '^[0-9a-f]{64}$'),
  shadow_target_identity_sha256 text COLLATE "C" NOT NULL CHECK (shadow_target_identity_sha256 ~ '^[0-9a-f]{64}$'),
  batch_request_sha256 text COLLATE "C" NOT NULL UNIQUE CHECK (batch_request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL CHECK (created_at NOT IN ('infinity'::timestamptz, '-infinity'::timestamptz))
);
CREATE TABLE migration_admission.migration_batch_events (
  batch_id text COLLATE "C" NOT NULL REFERENCES migration_admission.migration_batches(batch_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  event_sequence integer NOT NULL CHECK (event_sequence >= 1),
  status text COLLATE "C" NOT NULL CHECK (status IN ('prepared','running','reconciled','quarantined','rolled_back','failed','abandoned')),
  event_code text COLLATE "C" NOT NULL CHECK (event_code IN ('PREPARED','RUNNING','RECONCILED','QUARANTINED','ROLLED_BACK','SOURCE_SNAPSHOT_CHANGED','SOURCE_SCHEMA_DRIFT','TARGET_CATALOG_DRIFT','TARGET_NONEMPTY','RECONCILIATION_MISMATCH','TRANSACTION_UNCERTAIN')),
  event_sha256 text COLLATE "C" NOT NULL CHECK (event_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK ((status = 'prepared' AND event_code = 'PREPARED') OR (status = 'running' AND event_code = 'RUNNING') OR (status = 'reconciled' AND event_code = 'RECONCILED') OR (status = 'quarantined' AND event_code = 'QUARANTINED') OR (status = 'rolled_back' AND event_code = 'ROLLED_BACK') OR (status = 'failed' AND event_code IN ('SOURCE_SNAPSHOT_CHANGED','SOURCE_SCHEMA_DRIFT','TARGET_CATALOG_DRIFT','TARGET_NONEMPTY','RECONCILIATION_MISMATCH','TRANSACTION_UNCERTAIN')) OR (status = 'abandoned' AND event_code = 'TRANSACTION_UNCERTAIN')),
  created_at timestamptz NOT NULL CHECK (created_at NOT IN ('infinity'::timestamptz, '-infinity'::timestamptz)),
  PRIMARY KEY (batch_id, event_sequence)
);
CREATE TABLE migration_admission.migration_row_ledger (
  batch_id text COLLATE "C" NOT NULL REFERENCES migration_admission.migration_batches(batch_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_relation text COLLATE "C" NOT NULL CHECK (source_relation IN ('tenants','institutions','schools','rooms')),
  source_primary_key_sha256 text COLLATE "C" NOT NULL CHECK (source_primary_key_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_source_sha256 text COLLATE "C" NOT NULL CHECK (canonical_source_sha256 ~ '^[0-9a-f]{64}$'),
  target_id text COLLATE "C",
  target_logical_sha256 text COLLATE "C" CHECK (target_logical_sha256 IS NULL OR target_logical_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('admitted','quarantined')),
  outcome_code text COLLATE "C" NOT NULL CHECK (outcome_code IN ('ADMITTED','SOURCE_ROW_INVALID','DEPENDENCY_MISSING','IDENTITY_CONFLICT','CANONICAL_HASH_CONFLICT')),
  CHECK ((outcome = 'admitted' AND target_id IS NOT NULL AND btrim(target_id) <> '' AND target_logical_sha256 IS NOT NULL AND outcome_code = 'ADMITTED') OR (outcome = 'quarantined' AND target_id IS NULL AND target_logical_sha256 IS NULL AND outcome_code <> 'ADMITTED')),
  created_at timestamptz NOT NULL CHECK (created_at NOT IN ('infinity'::timestamptz, '-infinity'::timestamptz)),
  PRIMARY KEY (batch_id, source_relation, source_primary_key_sha256)
);
CREATE TABLE migration_admission.migration_quarantine (
  batch_id text COLLATE "C" NOT NULL,
  source_relation text COLLATE "C" NOT NULL,
  source_primary_key_sha256 text COLLATE "C" NOT NULL,
  reason_code text COLLATE "C" NOT NULL CHECK (reason_code IN ('SOURCE_ROW_INVALID','DEPENDENCY_MISSING','IDENTITY_CONFLICT','CANONICAL_HASH_CONFLICT')),
  sealed_artifact_reference_sha256 text COLLATE "C" CHECK (sealed_artifact_reference_sha256 IS NULL OR sealed_artifact_reference_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL CHECK (created_at NOT IN ('infinity'::timestamptz, '-infinity'::timestamptz)),
  PRIMARY KEY (batch_id, source_relation, source_primary_key_sha256),
  FOREIGN KEY (batch_id, source_relation, source_primary_key_sha256)
    REFERENCES migration_admission.migration_row_ledger(batch_id, source_relation, source_primary_key_sha256)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION migration_admission.migration_admission_no_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'append only'; END; $$;
CREATE FUNCTION migration_admission.migration_admission_no_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'append only'; END; $$;
CREATE FUNCTION migration_admission.migration_admission_schema_migrations_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ DECLARE expected_version integer; BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('migration_admission.schema_migrations')); SELECT COALESCE(MAX(semantic_version), 0) + 1 INTO expected_version FROM migration_admission.migration_admission_schema_migrations; IF NEW.semantic_version <> expected_version THEN RAISE EXCEPTION 'migration versions must be consecutive'; END IF; RETURN NEW; END; $$;
CREATE FUNCTION migration_admission.migration_batch_events_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ DECLARE previous_sequence integer; previous_status text; BEGIN PERFORM 1 FROM migration_admission.migration_batches WHERE batch_id = NEW.batch_id FOR UPDATE; SELECT event_sequence, status INTO previous_sequence, previous_status FROM migration_admission.migration_batch_events WHERE batch_id = NEW.batch_id ORDER BY event_sequence DESC LIMIT 1; IF previous_sequence IS NULL THEN IF NEW.event_sequence <> 1 OR NEW.status <> 'prepared' THEN RAISE EXCEPTION 'invalid initial batch event'; END IF; ELSIF NEW.event_sequence <> previous_sequence + 1 THEN RAISE EXCEPTION 'batch event sequence must be consecutive'; ELSIF (previous_status = 'prepared' AND NEW.status = 'running') OR (previous_status = 'running' AND NEW.status IN ('reconciled','quarantined','failed','abandoned')) OR (previous_status = 'reconciled' AND NEW.status = 'rolled_back') THEN NULL; ELSE RAISE EXCEPTION 'invalid batch event transition'; END IF; RETURN NEW; END; $$;
CREATE FUNCTION migration_admission.migration_batch_prepared_pair() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM migration_admission.migration_batch_events AS e WHERE e.batch_id = NEW.batch_id AND e.event_sequence = 1 AND e.status = 'prepared') THEN RAISE EXCEPTION 'batch requires prepared event'; END IF; RETURN NULL; END; $$;
CREATE FUNCTION migration_admission.migration_row_ledger_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ DECLARE batch_status text; BEGIN PERFORM 1 FROM migration_admission.migration_batches WHERE batch_id = NEW.batch_id FOR UPDATE; SELECT e.status INTO batch_status FROM migration_admission.migration_batch_events AS e WHERE e.batch_id = NEW.batch_id ORDER BY e.event_sequence DESC LIMIT 1; IF batch_status IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'row admission requires running batch'; END IF; RETURN NEW; END; $$;
CREATE FUNCTION migration_admission.migration_row_ledger_quarantine_pair() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ DECLARE ledger_outcome text; ledger_code text; quarantine_code text; BEGIN IF TG_TABLE_NAME = 'migration_row_ledger' THEN SELECT q.reason_code INTO quarantine_code FROM migration_admission.migration_quarantine AS q WHERE q.batch_id = NEW.batch_id AND q.source_relation = NEW.source_relation AND q.source_primary_key_sha256 = NEW.source_primary_key_sha256; IF NEW.outcome = 'quarantined' AND quarantine_code IS NULL THEN RAISE EXCEPTION 'quarantined row requires quarantine record'; ELSIF NEW.outcome = 'quarantined' AND quarantine_code IS DISTINCT FROM NEW.outcome_code THEN RAISE EXCEPTION 'quarantine reason must equal ledger code'; ELSIF NEW.outcome = 'admitted' AND quarantine_code IS NOT NULL THEN RAISE EXCEPTION 'admitted row cannot have quarantine record'; END IF; ELSE SELECT l.outcome, l.outcome_code INTO ledger_outcome, ledger_code FROM migration_admission.migration_row_ledger AS l WHERE l.batch_id = NEW.batch_id AND l.source_relation = NEW.source_relation AND l.source_primary_key_sha256 = NEW.source_primary_key_sha256; IF ledger_outcome IS DISTINCT FROM 'quarantined' THEN RAISE EXCEPTION 'quarantine requires quarantined ledger row'; ELSIF NEW.reason_code IS DISTINCT FROM ledger_code THEN RAISE EXCEPTION 'quarantine reason must equal ledger code'; END IF; END IF; RETURN NULL; END; $$;
CREATE TRIGGER migration_admission_schema_migrations_insert_guard BEFORE INSERT ON migration_admission.migration_admission_schema_migrations FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_schema_migrations_insert_guard();
CREATE TRIGGER migration_batch_events_insert_guard BEFORE INSERT ON migration_admission.migration_batch_events FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_batch_events_insert_guard();
CREATE CONSTRAINT TRIGGER migration_batch_prepared_pair AFTER INSERT ON migration_admission.migration_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_batch_prepared_pair();
CREATE TRIGGER migration_row_ledger_insert_guard BEFORE INSERT ON migration_admission.migration_row_ledger FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_row_ledger_insert_guard();
CREATE CONSTRAINT TRIGGER migration_row_ledger_quarantine_pair AFTER INSERT ON migration_admission.migration_row_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_row_ledger_quarantine_pair();
CREATE CONSTRAINT TRIGGER migration_quarantine_ledger_pair AFTER INSERT ON migration_admission.migration_quarantine DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_row_ledger_quarantine_pair();
CREATE TRIGGER migration_admission_schema_migrations_no_update BEFORE UPDATE ON migration_admission.migration_admission_schema_migrations FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_update();
CREATE TRIGGER migration_admission_schema_migrations_no_delete BEFORE DELETE ON migration_admission.migration_admission_schema_migrations FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_delete();
CREATE TRIGGER migration_batches_no_update BEFORE UPDATE ON migration_admission.migration_batches FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_update();
CREATE TRIGGER migration_batches_no_delete BEFORE DELETE ON migration_admission.migration_batches FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_delete();
CREATE TRIGGER migration_batch_events_no_update BEFORE UPDATE ON migration_admission.migration_batch_events FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_update();
CREATE TRIGGER migration_batch_events_no_delete BEFORE DELETE ON migration_admission.migration_batch_events FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_delete();
CREATE TRIGGER migration_row_ledger_no_update BEFORE UPDATE ON migration_admission.migration_row_ledger FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_update();
CREATE TRIGGER migration_row_ledger_no_delete BEFORE DELETE ON migration_admission.migration_row_ledger FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_delete();
CREATE TRIGGER migration_quarantine_no_update BEFORE UPDATE ON migration_admission.migration_quarantine FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_update();
CREATE TRIGGER migration_quarantine_no_delete BEFORE DELETE ON migration_admission.migration_quarantine FOR EACH ROW EXECUTE FUNCTION migration_admission.migration_admission_no_delete();
REVOKE EXECUTE ON FUNCTION migration_admission.migration_admission_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION migration_admission.migration_admission_no_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION migration_admission.migration_admission_schema_migrations_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION migration_admission.migration_batch_events_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION migration_admission.migration_batch_prepared_pair() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION migration_admission.migration_row_ledger_insert_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION migration_admission.migration_row_ledger_quarantine_pair() FROM PUBLIC;`;

const EXPECTED_BUSINESS_FOUNDATION_ADMISSION_MANIFEST_SHA256 = 'c42ce7340fd576c9743bcf1745f0be129992dc388d1200bafc2b71f340fcaa56';
const BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS = Object.freeze([Object.freeze({
  migrationId: 'business-foundation-admission-1',
  semanticVersion: 1,
  manifestSha256: sha256(SQL),
  sql: SQL,
})]);
const expectedBusinessFoundationAdmissionCatalog = Object.freeze({
  relations: Object.freeze([
    'migration_admission.migration_admission_schema_migrations',
    'migration_admission.migration_batches',
    'migration_admission.migration_batch_events',
    'migration_admission.migration_quarantine',
    'migration_admission.migration_row_ledger',
  ]),
});

module.exports = {
  BUSINESS_FOUNDATION_ADMISSION_MIGRATIONS,
  EXPECTED_BUSINESS_FOUNDATION_ADMISSION_MANIFEST_SHA256,
  expectedBusinessFoundationAdmissionCatalog,
  sha256,
};
