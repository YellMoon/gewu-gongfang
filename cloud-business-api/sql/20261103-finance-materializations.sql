BEGIN;
CREATE TABLE business.personal_finance_materializations (
 tenant_id text COLLATE "C" NOT NULL,
 account_id text COLLATE "C" NOT NULL,
 revision bigint NOT NULL CHECK(revision>=0),
 rules_version text COLLATE "C" NOT NULL CHECK(length(rules_version) BETWEEN 1 AND 128),
 valuation_day date NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','building','ready','failed','obsolete')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token text,
 lease_expires_at timestamptz,
 payload bytea,
 summary jsonb,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 completed_at timestamptz,
 PRIMARY KEY(tenant_id,account_id,revision,rules_version,valuation_day),
 FOREIGN KEY(tenant_id,account_id) REFERENCES business.personal_finance_owners,
 CHECK(state<>'ready' OR (payload IS NOT NULL AND summary IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX personal_finance_materializations_pending ON business.personal_finance_materializations(created_at)
 WHERE state IN ('pending','building');
CREATE INDEX personal_finance_materializations_ready ON business.personal_finance_materializations(tenant_id,account_id,completed_at DESC)
 WHERE state='ready';
REVOKE ALL ON business.personal_finance_materializations FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON business.personal_finance_materializations TO gewu_cloud_schedule_reader;
COMMIT;
