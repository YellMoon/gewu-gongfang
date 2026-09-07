-- UTF-8: operator-only receipts commit atomically with historical snapshot recovery.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;
CREATE TABLE IF NOT EXISTS business.schedule_snapshot_recovery_receipts (
  tenant_id text NOT NULL REFERENCES business.tenants(id),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  backup_sha256 text NOT NULL CHECK (backup_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('applied','rolled_back')),
  source_plan jsonb NOT NULL CHECK (jsonb_typeof(source_plan)='object'),
  applied_receipt jsonb NOT NULL CHECK (jsonb_typeof(applied_receipt)='object'),
  rollback_receipt jsonb,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rolled_back_at timestamptz,
  PRIMARY KEY (tenant_id,plan_sha256),
  CHECK ((source_plan->>'tenantId') IS NOT DISTINCT FROM tenant_id AND (applied_receipt->>'tenantId') IS NOT DISTINCT FROM tenant_id),
  CHECK ((state='applied' AND rollback_receipt IS NULL AND rolled_back_at IS NULL)
    OR (state='rolled_back' AND rollback_receipt IS NOT NULL AND jsonb_typeof(rollback_receipt)='object' AND rolled_back_at IS NOT NULL))
);
REVOKE ALL ON business.schedule_snapshot_recovery_receipts FROM PUBLIC,vnext_pg17_writer,vnext_pg17_business_verifier;
COMMIT;
