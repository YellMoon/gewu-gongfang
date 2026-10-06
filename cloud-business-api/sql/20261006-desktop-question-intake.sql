BEGIN;

ALTER TABLE business.question_import_tasks
  ADD COLUMN processing_location text COLLATE "C" NOT NULL DEFAULT 'storage_agent',
  ADD COLUMN local_parser_sha256 text COLLATE "C",
  ADD CONSTRAINT question_import_processing_location_check CHECK (
    (processing_location='storage_agent' AND local_parser_sha256 IS NULL)
    OR (processing_location='desktop' AND local_parser_sha256 ~ '^[0-9a-f]{64}$'
      AND local_parser_sha256 IS NOT NULL AND parser_contract_version=0)
  );

CREATE FUNCTION business.question_import_processing_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.processing_location IS DISTINCT FROM OLD.processing_location
    OR NEW.local_parser_sha256 IS DISTINCT FROM OLD.local_parser_sha256 THEN
    RAISE EXCEPTION 'question import processing audit is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER question_import_processing_no_update BEFORE UPDATE ON business.question_import_tasks
  FOR EACH ROW EXECUTE FUNCTION business.question_import_processing_no_update();
REVOKE EXECUTE ON FUNCTION business.question_import_processing_no_update() FROM PUBLIC;

CREATE TABLE business.encrypted_import_media_relays (
  storage_task_id text COLLATE "C" PRIMARY KEY REFERENCES business.storage_object_tasks(task_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  media_id text COLLATE "C" NOT NULL UNIQUE REFERENCES business.question_import_media_objects(media_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  import_task_id text COLLATE "C" NOT NULL REFERENCES business.question_import_tasks(task_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_account_id text COLLATE "C" NOT NULL CHECK (actor_account_id=btrim(actor_account_id) AND actor_account_id<>''),
  agent_key_fingerprint text COLLATE "C" NOT NULL CHECK (agent_key_fingerprint ~ '^[0-9a-f]{64}$'),
  envelope_json jsonb NOT NULL CHECK (jsonb_typeof(envelope_json)='object'),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 67108864),
  ciphertext_sha256 text COLLATE "C" NOT NULL CHECK (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at > created_at)
);
CREATE INDEX encrypted_import_media_relays_expiry_idx ON business.encrypted_import_media_relays(expires_at);
REVOKE ALL ON TABLE business.encrypted_import_media_relays FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE business.encrypted_import_media_relays TO gewu_cloud_schedule_reader;

COMMIT;
