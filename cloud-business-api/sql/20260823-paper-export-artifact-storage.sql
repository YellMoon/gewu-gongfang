BEGIN;

CREATE TABLE business.paper_export_artifacts (
  artifact_id text COLLATE "C" PRIMARY KEY CHECK (artifact_id ~ '^paper_artifact_[A-Za-z0-9_-]{8,128}$'),
  paper_task_id text COLLATE "C" NOT NULL REFERENCES business.paper_export_tasks(task_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  format text NOT NULL CHECK (format IN ('word','pdf')),
  file_name text NOT NULL CHECK (file_name=btrim(file_name) AND file_name<>'' AND length(file_name)<=512),
  mime_type text NOT NULL CHECK (mime_type=btrim(mime_type) AND mime_type<>'' AND length(mime_type)<=255),
  object_id text COLLATE "C" NOT NULL UNIQUE CHECK (object_id ~ '^obj_[A-Za-z0-9_-]{1,128}$'),
  object_version integer NOT NULL DEFAULT 1 CHECK (object_version=1),
  content_sha256 text COLLATE "C" NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 67108864),
  storage_task_id text COLLATE "C" NOT NULL UNIQUE REFERENCES business.storage_object_tasks(task_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  storage_state text NOT NULL DEFAULT 'queued' CHECK (storage_state IN ('queued','verified','failed','revoked')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  verified_at timestamptz
);
CREATE INDEX paper_export_artifacts_task_idx ON business.paper_export_artifacts(paper_task_id,created_at DESC);

CREATE TABLE business.encrypted_paper_export_artifact_relays (
  storage_task_id text COLLATE "C" PRIMARY KEY REFERENCES business.storage_object_tasks(task_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  artifact_id text COLLATE "C" NOT NULL UNIQUE REFERENCES business.paper_export_artifacts(artifact_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  agent_key_fingerprint text COLLATE "C" NOT NULL CHECK (agent_key_fingerprint ~ '^[0-9a-f]{64}$'),
  envelope_json jsonb NOT NULL CHECK (jsonb_typeof(envelope_json)='object'),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 67108864),
  ciphertext_sha256 text COLLATE "C" NOT NULL CHECK (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at > created_at)
);
CREATE INDEX encrypted_paper_export_artifact_relays_expiry_idx ON business.encrypted_paper_export_artifact_relays(expires_at);

REVOKE ALL ON TABLE business.paper_export_artifacts,business.encrypted_paper_export_artifact_relays FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE business.paper_export_artifacts,business.encrypted_paper_export_artifact_relays TO gewu_cloud_schedule_reader;

COMMIT;
