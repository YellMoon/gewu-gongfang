BEGIN;

CREATE TABLE IF NOT EXISTS business.miniapp_cloud_role_grant_retirements (
  account_id text NOT NULL,
  retired_role text NOT NULL CHECK (retired_role='admin'),
  prior_status text NOT NULL CHECK (prior_status IN ('active','revoked')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  retired_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (account_id, retired_role)
);

INSERT INTO business.miniapp_cloud_role_grant_retirements
  (account_id,retired_role,prior_status,created_at,updated_at)
SELECT account_id,role,status,created_at,updated_at
  FROM business.miniapp_cloud_role_grants
 WHERE role='admin'
ON CONFLICT (account_id,retired_role) DO NOTHING;

DELETE FROM business.miniapp_cloud_role_grants WHERE role='admin';

ALTER TABLE business.miniapp_cloud_role_grants
  DROP CONSTRAINT IF EXISTS miniapp_cloud_role_grants_role_check;
ALTER TABLE business.miniapp_cloud_role_grants
  ADD CONSTRAINT miniapp_cloud_role_grants_role_check
  CHECK (role IN ('super_admin','teacher','student'));
ALTER TABLE business.miniapp_cloud_role_grants
  DROP CONSTRAINT IF EXISTS miniapp_cloud_role_grants_profile_check;
ALTER TABLE business.miniapp_cloud_role_grants
  ADD CONSTRAINT miniapp_cloud_role_grants_profile_check CHECK (
    (role IN ('teacher','student') AND profile_type=role AND profile_id IS NOT NULL AND profile_id=btrim(profile_id) AND profile_id <> '')
    OR (role='super_admin' AND profile_type IS NULL AND profile_id IS NULL)
  );

REVOKE ALL ON TABLE business.miniapp_cloud_role_grant_retirements FROM PUBLIC;
GRANT SELECT,INSERT ON TABLE business.miniapp_cloud_role_grant_retirements TO gewu_cloud_schedule_reader;

COMMIT;
