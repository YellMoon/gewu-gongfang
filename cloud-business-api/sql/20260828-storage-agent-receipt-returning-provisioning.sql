BEGIN;

-- The generic storage completion endpoint returns the immutable receipt time.
-- Keep this read permission column-scoped; the receipt payload remains private.
GRANT SELECT (verified_at) ON TABLE business.storage_task_receipts TO gewu_cloud_schedule_reader;

COMMIT;
