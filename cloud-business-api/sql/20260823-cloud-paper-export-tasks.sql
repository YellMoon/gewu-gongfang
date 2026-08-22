BEGIN;

CREATE TABLE business.paper_export_tasks (
  task_id text COLLATE "C" PRIMARY KEY CHECK (task_id ~ '^paper_task_[A-Za-z0-9_-]{1,128}$'),
  tenant_id text COLLATE "C" NOT NULL REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  account_id text COLLATE "C" NOT NULL CHECK (account_id=btrim(account_id) AND account_id<>''),
  idempotency_key text COLLATE "C" NOT NULL CHECK (idempotency_key=btrim(idempotency_key) AND idempotency_key<>''),
  task_type text NOT NULL CHECK (task_type IN ('paper-export-word','paper-export-pdf')),
  request_json jsonb NOT NULL CHECK (jsonb_typeof(request_json)='object'),
  request_hash text COLLATE "C" NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  question_snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(question_snapshot_json)='array'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  phase text NOT NULL DEFAULT 'queued' CHECK (phase=btrim(phase) AND phase<>''),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (tenant_id,account_id,idempotency_key)
);
CREATE INDEX paper_export_tasks_queue_idx ON business.paper_export_tasks(status,created_at);
REVOKE ALL ON TABLE business.paper_export_tasks FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON TABLE business.paper_export_tasks TO gewu_cloud_schedule_reader;

COMMIT;
