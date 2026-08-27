BEGIN;

-- The cloud runtime may create a storage task only while creating an
-- authenticated question-import task. It receives no receipt or delete grant.
GRANT INSERT ON TABLE business.storage_object_tasks TO gewu_cloud_schedule_reader;

COMMIT;
