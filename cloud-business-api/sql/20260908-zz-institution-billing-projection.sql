BEGIN;
-- UTF-8: existing cloud read role may expose the canonical relationship;
-- it gains no write privilege and the tenant/role filter remains in the API.
GRANT SELECT ON business.institution_billing_students TO gewu_cloud_schedule_reader;
COMMIT;
