BEGIN;

-- Additive only: legacy renderers have no lease and are not automatically reaped.
ALTER TABLE business.paper_export_tasks
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS paper_export_tasks_render_lease_idx
  ON business.paper_export_tasks(lease_expires_at)
  WHERE status='processing' AND phase='rendering' AND claim_token IS NOT NULL;

COMMIT;
