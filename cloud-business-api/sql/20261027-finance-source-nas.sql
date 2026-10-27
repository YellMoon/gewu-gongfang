-- Metadata and verified receipts only. Bill bytes must never enter this table.
BEGIN;
CREATE TABLE business.personal_finance_source_objects (
 reference_id text COLLATE "C" PRIMARY KEY CHECK(reference_id ~ '^[a-f0-9]{64}-[a-f0-9]{64}$'),
 object_id text COLLATE "C" NOT NULL UNIQUE CHECK(object_id='obj_bill_' || encode(sha256(convert_to(reference_id,'UTF8')),'hex')),
 object_version integer NOT NULL DEFAULT 1 CHECK(object_version=1),
 encrypted_sha256 text COLLATE "C" NOT NULL CHECK(encrypted_sha256 ~ '^[a-f0-9]{64}$'),
 encrypted_bytes integer NOT NULL CHECK(encrypted_bytes BETWEEN 33 AND 25165856),
 verified_agent_id text COLLATE "C" NOT NULL CHECK(length(verified_agent_id) BETWEEN 3 AND 64),
 verified_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
REVOKE ALL ON business.personal_finance_source_objects FROM PUBLIC;
GRANT SELECT,INSERT ON business.personal_finance_source_objects TO gewu_cloud_schedule_reader;
COMMIT;
