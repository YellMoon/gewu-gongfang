BEGIN;

GRANT SELECT,UPDATE ON TABLE business.storage_object_tasks TO gewu_cloud_schedule_reader;
GRANT INSERT ON TABLE business.storage_task_receipts TO gewu_cloud_schedule_reader;

COMMIT;
