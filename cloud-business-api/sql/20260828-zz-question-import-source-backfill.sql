BEGIN;

-- Older confirmed imports predate source propagation.  Recover a label only
-- when the NAS-object chain identifies exactly one original import filename.
-- Questions without that unique evidence deliberately retain an empty source.
WITH source_matches AS (
  SELECT asset.tenant_id,asset.question_id,task.source_file_name
    FROM business.question_assets asset
    JOIN business.question_import_media_objects media
      ON media.object_id=asset.storage_object_id
     AND media.object_version=asset.storage_object_version
     AND media.expected_sha256=asset.content_hash
    JOIN business.question_import_items item
      ON item.import_task_id=media.import_task_id
     AND item.item_index=media.item_index
    JOIN business.question_import_tasks task
      ON task.task_id=media.import_task_id
     AND task.tenant_id=asset.tenant_id
   WHERE asset.deleted=false
     AND asset.state='verified'
     AND media.storage_state='verified'
     AND item.status='submitted'
     AND NULLIF(btrim(task.source_file_name),'') IS NOT NULL
), unique_sources AS (
  SELECT tenant_id,question_id,MIN(source_file_name) AS source_file_name
    FROM source_matches
   GROUP BY tenant_id,question_id
  HAVING COUNT(DISTINCT source_file_name)=1
)
UPDATE business.questions question
   SET source=source.source_file_name,
       updated_at=transaction_timestamp()
  FROM unique_sources source
 WHERE question.tenant_id=source.tenant_id
   AND question.id=source.question_id
   AND question.deleted=false
   AND COALESCE(question.source,'')='';

COMMIT;
