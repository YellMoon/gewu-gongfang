BEGIN;

-- A source-import completion has exactly one immutable verification receipt.
-- The cloud runtime may insert it, but cannot alter or remove audit evidence.
GRANT INSERT ON TABLE business.storage_task_receipts TO gewu_cloud_schedule_reader;

COMMIT;
