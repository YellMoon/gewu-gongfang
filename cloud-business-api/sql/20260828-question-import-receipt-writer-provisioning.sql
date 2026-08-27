BEGIN;

-- The API connection runs as vnext_pg17_writer; permit only creation of the
-- immutable source-verification receipt required by question import.
GRANT INSERT ON TABLE business.storage_task_receipts TO vnext_pg17_writer;

COMMIT;
