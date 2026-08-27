BEGIN;

-- The cloud runtime may create source/media tasks and record a one-time
-- verification receipt while completing an authenticated question import.
-- It receives neither receipt mutation nor delete authority.
GRANT INSERT ON TABLE business.storage_object_tasks TO gewu_cloud_schedule_reader;
GRANT INSERT ON TABLE business.storage_task_receipts TO gewu_cloud_schedule_reader;

COMMIT;
