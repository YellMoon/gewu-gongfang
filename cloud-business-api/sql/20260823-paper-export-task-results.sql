BEGIN;

ALTER TABLE business.paper_export_tasks
  ADD COLUMN result_artifact_id text COLLATE "C",
  ADD COLUMN error_code text COLLATE "C";
ALTER TABLE business.paper_export_tasks
  ADD CONSTRAINT paper_export_tasks_result_artifact_fk
  FOREIGN KEY (result_artifact_id) REFERENCES business.paper_export_artifacts(artifact_id) ON UPDATE RESTRICT ON DELETE RESTRICT;

COMMIT;
