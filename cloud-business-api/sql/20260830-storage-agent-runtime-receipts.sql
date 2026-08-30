BEGIN;

CREATE TABLE business.storage_agent_runtime_receipts (
  receipt_id text COLLATE "C" PRIMARY KEY CHECK (receipt_id ~ '^storage_runtime_receipt_[A-Za-z0-9_-]{8,128}$'),
  agent_id text COLLATE "C" NOT NULL CHECK (agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  agent_version text COLLATE "C" NOT NULL CHECK (agent_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  contracts jsonb NOT NULL CHECK (
    jsonb_typeof(contracts)='object'
    AND contracts = jsonb_build_object('questionPaperExport',3,'storageAgentTransport',2)
  ),
  observed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX storage_agent_runtime_receipts_latest_idx
  ON business.storage_agent_runtime_receipts(agent_id, observed_at DESC);

CREATE FUNCTION business.storage_agent_runtime_receipts_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'storage agent runtime receipts are append-only' USING ERRCODE = 'P0001';
END;
$$;

CREATE FUNCTION business.storage_agent_runtime_receipts_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'storage agent runtime receipts are append-only' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER storage_agent_runtime_receipts_no_update
  BEFORE UPDATE ON business.storage_agent_runtime_receipts
  FOR EACH ROW EXECUTE FUNCTION business.storage_agent_runtime_receipts_no_update();
CREATE TRIGGER storage_agent_runtime_receipts_no_delete
  BEFORE DELETE ON business.storage_agent_runtime_receipts
  FOR EACH ROW EXECUTE FUNCTION business.storage_agent_runtime_receipts_no_delete();

REVOKE ALL ON TABLE business.storage_agent_runtime_receipts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.storage_agent_runtime_receipts_no_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.storage_agent_runtime_receipts_no_delete() FROM PUBLIC;
GRANT INSERT ON TABLE business.storage_agent_runtime_receipts TO gewu_cloud_schedule_reader;
GRANT SELECT (receipt_id,agent_id,agent_version,contracts,observed_at) ON TABLE business.storage_agent_runtime_receipts TO gewu_cloud_schedule_reader;

COMMIT;
