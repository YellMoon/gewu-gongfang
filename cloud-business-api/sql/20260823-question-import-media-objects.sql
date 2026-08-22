BEGIN;

CREATE TABLE business.question_import_media_objects (
  media_id text COLLATE "C" PRIMARY KEY CHECK (media_id ~ '^question_import_media_[A-Za-z0-9_-]{1,128}$'),
  import_task_id text COLLATE "C" NOT NULL REFERENCES business.question_import_tasks(task_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  item_index integer NOT NULL CHECK (item_index >= 0),
  asset_index integer NOT NULL CHECK (asset_index >= 0),
  object_id text COLLATE "C" NOT NULL CHECK (object_id ~ '^obj_[A-Za-z0-9_-]{1,128}$'),
  object_version integer NOT NULL CHECK (object_version > 0),
  storage_task_id text COLLATE "C" NOT NULL UNIQUE REFERENCES business.storage_object_tasks(task_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  expected_sha256 text COLLATE "C" NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_bytes bigint NOT NULL CHECK (expected_bytes BETWEEN 1 AND 67108864),
  mime_type text NOT NULL CHECK (mime_type=btrim(mime_type) AND mime_type<>''),
  storage_state text COLLATE "C" NOT NULL CHECK (storage_state IN ('queued','verified','quarantined')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (import_task_id,item_index,asset_index),
  UNIQUE (object_id,object_version),
  CONSTRAINT question_import_media_item_fk FOREIGN KEY (import_task_id,item_index)
    REFERENCES business.question_import_items(import_task_id,item_index) ON UPDATE RESTRICT ON DELETE CASCADE,
  CHECK ((storage_state='verified' AND verified_at IS NOT NULL) OR (storage_state<>'verified' AND verified_at IS NULL))
);

CREATE INDEX question_import_media_task_idx
  ON business.question_import_media_objects(import_task_id,item_index,asset_index);

REVOKE ALL ON TABLE business.question_import_media_objects FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON TABLE business.question_import_media_objects TO gewu_cloud_schedule_reader;

COMMIT;
