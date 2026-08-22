BEGIN;

CREATE TABLE business.desktop_question_command_receipts (
  tenant_id text COLLATE "C" NOT NULL CHECK (tenant_id = btrim(tenant_id) AND tenant_id <> ''),
  command_id text COLLATE "C" NOT NULL CHECK (command_id = btrim(command_id) AND command_id <> ''),
  payload_hash text COLLATE "C" NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text COLLATE "C" NOT NULL CHECK (status IN ('committed')),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json)='object'),
  result_hash text COLLATE "C" NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  actor_account_id text COLLATE "C" NOT NULL CHECK (actor_account_id = btrim(actor_account_id) AND actor_account_id <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,command_id),
  CONSTRAINT desktop_question_command_receipts_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

REVOKE ALL ON TABLE business.desktop_question_command_receipts FROM PUBLIC;
GRANT SELECT,INSERT ON TABLE business.desktop_question_command_receipts TO gewu_cloud_schedule_reader;

COMMIT;
