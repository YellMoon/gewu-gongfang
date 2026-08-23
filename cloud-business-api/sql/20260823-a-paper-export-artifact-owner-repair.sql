BEGIN;

-- Historical instances created these tables under the runtime role before the
-- cloud migration ledger existed.  Reset to the dedicated migrator so the
-- repair can run once; fresh instances see no tables and safely no-op.
RESET ROLE;
ALTER TABLE IF EXISTS business.paper_export_artifacts OWNER TO vnext_pg17_business_owner;
ALTER TABLE IF EXISTS business.encrypted_paper_export_artifact_relays OWNER TO vnext_pg17_business_owner;

COMMIT;
