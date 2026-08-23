BEGIN;

CREATE TABLE business.miniapp_artifact_deliveries (
  delivery_id text COLLATE "C" PRIMARY KEY CHECK (delivery_id ~ '^delivery_[A-Za-z0-9_-]{8,128}$'),
  artifact_id text COLLATE "C" NOT NULL REFERENCES business.paper_export_artifacts(artifact_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  paper_task_id text COLLATE "C" NOT NULL REFERENCES business.paper_export_tasks(task_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  object_id text COLLATE "C" NOT NULL CHECK (object_id ~ '^obj_[A-Za-z0-9_-]{1,128}$'),
  expected_sha256 text COLLATE "C" NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_bytes bigint NOT NULL CHECK (expected_bytes BETWEEN 1 AND 67108864),
  file_name text NOT NULL CHECK (file_name=btrim(file_name) AND file_name<>'' AND length(file_name)<=512),
  mime_type text NOT NULL CHECK (mime_type=btrim(mime_type) AND mime_type<>'' AND length(mime_type)<=255),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','ready','failed')),
  lease_agent_id text COLLATE "C",
  lease_token_sha256 text COLLATE "C" CHECK (lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0 AND attempts<=100),
  artifact_bytes bytea CHECK (artifact_bytes IS NULL OR octet_length(artifact_bytes) BETWEEN 1 AND 67108864),
  downloaded_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at>created_at),
  CHECK (status<>'ready' OR artifact_bytes IS NOT NULL),
  CHECK ((status<>'leased') OR (lease_agent_id IS NOT NULL AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX miniapp_artifact_deliveries_lease_idx ON business.miniapp_artifact_deliveries(status,created_at,delivery_id);
CREATE INDEX miniapp_artifact_deliveries_owner_idx ON business.miniapp_artifact_deliveries(tenant_id,account_id,paper_task_id,expires_at DESC);
CREATE INDEX miniapp_artifact_deliveries_expiry_idx ON business.miniapp_artifact_deliveries(expires_at);

REVOKE ALL ON TABLE business.miniapp_artifact_deliveries FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE business.miniapp_artifact_deliveries TO gewu_cloud_schedule_reader;

COMMIT;
