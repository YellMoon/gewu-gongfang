-- A source document may contain observations for several owned accounts.
-- Keep its original import identifier and retain both owner and account FKs.
BEGIN;
DO $migration$
DECLARE guard_name text; guard_count integer;
BEGIN
 SELECT count(*),min(conname) INTO guard_count,guard_name FROM pg_constraint
 WHERE conrelid='business.personal_finance_observations'::regclass AND contype='f'
 AND confrelid='business.personal_finance_imports'::regclass AND cardinality(conkey)=4;
 IF guard_count<>1 THEN RAISE EXCEPTION 'FINANCE_IMPORT_CONSTRAINT_AMBIGUOUS'; END IF;
 EXECUTE format('ALTER TABLE business.personal_finance_observations DROP CONSTRAINT %I',guard_name);
END $migration$;
ALTER TABLE business.personal_finance_observations ADD CONSTRAINT personal_finance_observations_owner_import_fk
 FOREIGN KEY(tenant_id,account_id,import_id) REFERENCES business.personal_finance_imports(tenant_id,account_id,id);
-- Reconciliation uses source precedence. Preserve the accepted source sequence
-- outside immutable JSON; later API additions follow it using the prior order.
ALTER TABLE business.personal_finance_accounts ADD COLUMN ledger_ordinal bigint CHECK(ledger_ordinal>0);
ALTER TABLE business.personal_finance_imports ADD COLUMN ledger_ordinal bigint CHECK(ledger_ordinal>0);
ALTER TABLE business.personal_finance_observations ADD COLUMN ledger_ordinal bigint CHECK(ledger_ordinal>0);
ALTER TABLE business.personal_finance_annotations ADD COLUMN ledger_ordinal bigint CHECK(ledger_ordinal>0);
ALTER TABLE business.personal_finance_links ADD COLUMN ledger_ordinal bigint CHECK(ledger_ordinal>0);
ALTER TABLE business.personal_finance_balance_snapshots ADD COLUMN ledger_ordinal bigint CHECK(ledger_ordinal>0);
COMMIT;
