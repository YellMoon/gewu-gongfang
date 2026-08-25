BEGIN;

CREATE TABLE business.miniapp_cloud_accounts (
  account_id text PRIMARY KEY CHECK (account_id = btrim(account_id) AND account_id <> ''),
  phone_hmac char(64) NOT NULL UNIQUE CHECK (phone_hmac ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE business.miniapp_cloud_role_grants (
  account_id text NOT NULL REFERENCES business.miniapp_cloud_accounts(account_id),
  role text NOT NULL CHECK (role IN ('super_admin','teacher','student')),
  status text NOT NULL CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (account_id, role)
);

REVOKE ALL ON business.miniapp_cloud_accounts,business.miniapp_cloud_role_grants FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON business.miniapp_cloud_accounts,business.miniapp_cloud_role_grants TO gewu_cloud_schedule_reader;

COMMIT;
