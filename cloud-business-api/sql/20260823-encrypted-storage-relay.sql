BEGIN;

CREATE TABLE business.encrypted_storage_relays (
  task_id text COLLATE "C" PRIMARY KEY REFERENCES business.storage_object_tasks(task_id) ON UPDATE RESTRICT ON DELETE CASCADE,
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  question_asset_id text COLLATE "C" NOT NULL REFERENCES business.question_assets(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_account_id text COLLATE "C" NOT NULL CHECK (actor_account_id=btrim(actor_account_id) AND actor_account_id<>''),
  agent_key_fingerprint text COLLATE "C" NOT NULL CHECK (agent_key_fingerprint ~ '^[0-9a-f]{64}$'),
  envelope_json jsonb NOT NULL CHECK (jsonb_typeof(envelope_json)='object'),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 67108864),
  ciphertext_sha256 text COLLATE "C" NOT NULL CHECK (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT encrypted_storage_relays_asset_unique UNIQUE (tenant_id,question_asset_id),
  CONSTRAINT encrypted_storage_relays_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX encrypted_storage_relays_expiry_idx
  ON business.encrypted_storage_relays(expires_at);

REVOKE ALL ON TABLE business.encrypted_storage_relays FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON TABLE business.encrypted_storage_relays TO gewu_cloud_schedule_reader;

COMMIT;
