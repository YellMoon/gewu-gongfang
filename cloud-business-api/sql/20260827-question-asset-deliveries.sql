BEGIN;

CREATE TABLE business.question_asset_deliveries (
  delivery_id text COLLATE "C" PRIMARY KEY CHECK (delivery_id ~ '^question_asset_delivery_[A-Za-z0-9_-]{8,128}$'),
  asset_id text COLLATE "C" NOT NULL REFERENCES business.question_assets(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  object_id text COLLATE "C" NOT NULL CHECK (object_id ~ '^obj_[A-Za-z0-9_-]{1,128}$'),
  object_version integer NOT NULL CHECK (object_version>0),
  expected_sha256 text COLLATE "C" NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  expected_bytes bigint NOT NULL CHECK (expected_bytes BETWEEN 1 AND 67108864),
  file_name text NOT NULL CHECK (file_name=btrim(file_name) AND file_name<>'' AND length(file_name)<=512),
  mime_type text NOT NULL CHECK (mime_type=btrim(mime_type) AND mime_type<>'' AND length(mime_type)<=255),
  status text COLLATE "C" NOT NULL CHECK (status IN ('queued','leased','ready')),
  asset_bytes bytea,
  lease_agent_id text COLLATE "C",
  lease_token_sha256 text COLLATE "C",
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  downloaded_at timestamptz,
  CHECK (expires_at>created_at),
  CHECK ((status<>'ready') OR asset_bytes IS NOT NULL),
  CHECK ((status<>'leased') OR (lease_agent_id IS NOT NULL AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE INDEX question_asset_deliveries_lease_idx ON business.question_asset_deliveries(status,created_at,delivery_id);
CREATE INDEX question_asset_deliveries_owner_idx ON business.question_asset_deliveries(tenant_id,account_id,expected_sha256,expires_at DESC);
CREATE INDEX question_asset_deliveries_expiry_idx ON business.question_asset_deliveries(expires_at);

REVOKE ALL ON TABLE business.question_asset_deliveries FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE business.question_asset_deliveries TO gewu_cloud_schedule_reader;

COMMIT;
