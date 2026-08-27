BEGIN;

-- INSERT ... RETURNING task_id requires SELECT on that returned column.
-- Keep the runtime grant column-scoped so receipt contents remain unreadable.
GRANT SELECT (task_id) ON TABLE business.storage_task_receipts TO gewu_cloud_schedule_reader;

COMMIT;
