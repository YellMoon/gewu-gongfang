BEGIN;

CREATE TABLE business.student_contact_directory (
  contact_id text PRIMARY KEY CHECK (contact_id=btrim(contact_id) AND contact_id<>''),
  student_id text NOT NULL,
  contact_slot smallint NOT NULL CHECK (contact_slot BETWEEN 1 AND 3),
  relationship text NOT NULL CHECK (relationship IN ('student','guardian')),
  phone_value text CHECK (phone_value IS NULL OR phone_value ~ '^1[3-9][0-9]{9}$'),
  phone_hmac char(64) CHECK (phone_hmac IS NULL OR phone_hmac ~ '^[0-9a-f]{64}$'),
  wechat_handle text CHECK (wechat_handle IS NULL OR (wechat_handle=btrim(wechat_handle) AND wechat_handle<>'')),
  status text NOT NULL CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  CHECK (phone_value IS NOT NULL OR wechat_handle IS NOT NULL),
  CHECK ((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)),
  UNIQUE (student_id,contact_slot),
  FOREIGN KEY (student_id) REFERENCES business.students(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

REVOKE ALL ON business.student_contact_directory FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON business.student_contact_directory TO gewu_cloud_schedule_reader;

COMMIT;
