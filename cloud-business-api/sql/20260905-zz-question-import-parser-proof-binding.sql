BEGIN;

ALTER TABLE business.storage_agent_runtime_receipts
  ADD CONSTRAINT storage_agent_runtime_receipts_id_parser_unique
  UNIQUE (receipt_id,parser_sha256);

ALTER TABLE business.question_import_tasks
  ADD COLUMN parser_contract_version smallint NOT NULL DEFAULT 0,
  ADD COLUMN parser_sha256 text COLLATE "C",
  ADD COLUMN parser_runtime_receipt_id text COLLATE "C";

ALTER TABLE business.question_import_tasks
  ADD CONSTRAINT question_import_tasks_parser_proof_check CHECK (
    (
      parser_contract_version=0
      AND parser_sha256 IS NULL
      AND parser_runtime_receipt_id IS NULL
    )
    OR
    (
      parser_contract_version=1
      AND parser_sha256 IS NOT NULL
      AND parser_sha256 ~ '^[0-9a-f]{64}$'
      AND parser_runtime_receipt_id IS NOT NULL
    )
  ),
  ADD CONSTRAINT question_import_tasks_parser_runtime_receipt_fk
  FOREIGN KEY (parser_runtime_receipt_id,parser_sha256)
  REFERENCES business.storage_agent_runtime_receipts(receipt_id,parser_sha256)
  MATCH FULL ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE FUNCTION business.question_import_parser_proof_no_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.parser_contract_version IS DISTINCT FROM OLD.parser_contract_version
    OR NEW.parser_sha256 IS DISTINCT FROM OLD.parser_sha256
    OR NEW.parser_runtime_receipt_id IS DISTINCT FROM OLD.parser_runtime_receipt_id THEN
    RAISE EXCEPTION 'question import parser proof is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER question_import_parser_proof_no_update
  BEFORE UPDATE ON business.question_import_tasks
  FOR EACH ROW EXECUTE FUNCTION business.question_import_parser_proof_no_update();

REVOKE EXECUTE ON FUNCTION business.question_import_parser_proof_no_update() FROM PUBLIC;

COMMIT;
