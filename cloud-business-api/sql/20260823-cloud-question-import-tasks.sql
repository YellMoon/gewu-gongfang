BEGIN;

CREATE TABLE business.question_import_tasks (
  task_id text COLLATE "C" PRIMARY KEY CHECK (task_id ~ '^question_import_task_[A-Za-z0-9_-]{1,128}$'),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  idempotency_key text COLLATE "C" NOT NULL CHECK (idempotency_key=btrim(idempotency_key) AND idempotency_key<>''),
  source_type text COLLATE "C" NOT NULL CHECK (source_type IN ('lecture','exam')),
  source_file_name text NOT NULL CHECK (source_file_name=btrim(source_file_name) AND source_file_name<>''),
  source_mime_type text NOT NULL CHECK (source_mime_type=btrim(source_mime_type) AND source_mime_type<>''),
  source_sha256 text COLLATE "C" NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_size_bytes bigint NOT NULL CHECK (source_size_bytes BETWEEN 1 AND 67108864),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json)='object'),
  request_hash text COLLATE "C" NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text COLLATE "C" NOT NULL CHECK (status IN ('awaiting_source_storage','queued_for_parse','parsing','candidates_ready','drafts_prepared','submitted','failed','cancelled','quarantined')),
  phase text NOT NULL CHECK (phase=btrim(phase) AND phase<>''),
  error_code text COLLATE "C",
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (tenant_id,account_id,idempotency_key)
);
CREATE INDEX question_import_tasks_queue_idx ON business.question_import_tasks(status,created_at);

CREATE TABLE business.import_source_objects (
  import_task_id text COLLATE "C" PRIMARY KEY REFERENCES business.question_import_tasks(task_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
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
  UNIQUE (object_id,object_version),
  CHECK ((storage_state='verified' AND verified_at IS NOT NULL) OR (storage_state<>'verified' AND verified_at IS NULL))
);

CREATE TABLE business.question_import_items (
  item_id text COLLATE "C" PRIMARY KEY CHECK (item_id ~ '^question_import_item_[A-Za-z0-9_-]{1,128}$'),
  import_task_id text COLLATE "C" NOT NULL REFERENCES business.question_import_tasks(task_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  item_index integer NOT NULL CHECK (item_index >= 0),
  content_hash text COLLATE "C" NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  candidate_json jsonb NOT NULL CHECK (jsonb_typeof(candidate_json)='object'),
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_json)='object'),
  media_manifest_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media_manifest_json)='array'),
  status text COLLATE "C" NOT NULL CHECK (status IN ('pending','accepted','warning','rejected','draft_prepared','submitted')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (import_task_id,item_index)
);
CREATE INDEX question_import_items_task_idx ON business.question_import_items(import_task_id,item_index);

REVOKE ALL ON TABLE business.question_import_tasks, business.import_source_objects, business.question_import_items FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON TABLE business.question_import_tasks, business.import_source_objects, business.question_import_items TO gewu_cloud_schedule_reader;

COMMIT;
