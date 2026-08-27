BEGIN;

-- The production cloud API connects as gewu_app, so this must mirror the
-- immutable receipt insert granted to the constrained schedule-reader role.
GRANT INSERT ON TABLE business.storage_task_receipts TO gewu_cloud_schedule_reader;
GRANT INSERT ON TABLE business.storage_task_receipts TO gewu_app;

COMMIT;
