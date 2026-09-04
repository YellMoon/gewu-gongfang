BEGIN;

ALTER TABLE business.storage_agent_runtime_receipts
  ADD COLUMN parser_sha256 text COLLATE "C";

ALTER TABLE business.storage_agent_runtime_receipts
  DROP CONSTRAINT storage_agent_runtime_receipts_contracts_check;

ALTER TABLE business.storage_agent_runtime_receipts
  ADD CONSTRAINT storage_agent_runtime_receipts_contracts_check CHECK (
    (
      contracts = jsonb_build_object('questionPaperExport',3,'storageAgentTransport',2)
      AND parser_sha256 IS NULL
    )
    OR
    (
      contracts = jsonb_build_object('questionPaperExport',3,'storageAgentTransport',3,'questionImportParserProof',1)
      AND parser_sha256 IS NOT NULL
      AND parser_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

GRANT SELECT (parser_sha256) ON TABLE business.storage_agent_runtime_receipts TO gewu_cloud_schedule_reader;

COMMIT;
