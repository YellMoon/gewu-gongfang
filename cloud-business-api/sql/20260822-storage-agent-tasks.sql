BEGIN;

CREATE TABLE business.storage_object_tasks (
  task_id text COLLATE "C" PRIMARY KEY CHECK (task_id ~ '^task_[A-Za-z0-9_-]{8,128}$'),
  object_id text COLLATE "C" NOT NULL CHECK (object_id ~ '^obj_[A-Za-z0-9_-]{1,128}$'),
  object_version integer NOT NULL CHECK (object_version > 0),
  expected_sha256 text COLLATE "C" NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_bytes bigint NOT NULL CHECK (expected_bytes >= 0),
  media_type text NOT NULL CHECK (media_type=btrim(media_type) AND media_type <> '' AND length(media_type) <= 255),
  state text COLLATE "C" NOT NULL CHECK (state IN ('queued','leased','verified','failed_retryable','quarantined')),
  lease_agent_id text COLLATE "C",
  lease_token_sha256 text COLLATE "C" CHECK (lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text COLLATE "C",
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (object_id, object_version),
  CHECK (
    (state='leased' AND lease_agent_id IS NOT NULL AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased')
  )
);

CREATE TABLE business.storage_task_receipts (
  receipt_id text COLLATE "C" PRIMARY KEY CHECK (receipt_id ~ '^storage_receipt_[A-Za-z0-9_-]{8,128}$'),
  task_id text COLLATE "C" NOT NULL UNIQUE REFERENCES business.storage_object_tasks(task_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  agent_id text COLLATE "C" NOT NULL CHECK (agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  observed_sha256 text COLLATE "C" NOT NULL CHECK (observed_sha256 ~ '^[0-9a-f]{64}$'),
  observed_bytes bigint NOT NULL CHECK (observed_bytes >= 0),
  verified_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX storage_object_tasks_lease_idx
  ON business.storage_object_tasks(state, lease_expires_at, created_at);

CREATE FUNCTION business.storage_task_receipts_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'storage task receipts are append-only' USING ERRCODE = 'P0001';
END;
$$;

CREATE FUNCTION business.storage_task_receipts_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'storage task receipts are append-only' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER storage_task_receipts_no_update
  BEFORE UPDATE ON business.storage_task_receipts
  FOR EACH ROW EXECUTE FUNCTION business.storage_task_receipts_no_update();
CREATE TRIGGER storage_task_receipts_no_delete
  BEFORE DELETE ON business.storage_task_receipts
  FOR EACH ROW EXECUTE FUNCTION business.storage_task_receipts_no_delete();

REVOKE ALL ON TABLE business.storage_object_tasks, business.storage_task_receipts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.storage_task_receipts_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.storage_task_receipts_no_delete() FROM PUBLIC;

COMMIT;
