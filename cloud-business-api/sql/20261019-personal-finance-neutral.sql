-- Preserve platform non-income/non-expense records without inventing a cash direction.
DO $migration$
DECLARE guard_name text; guard_count integer;
BEGIN
 SELECT count(*),min(conname) INTO guard_count,guard_name FROM pg_constraint
 WHERE conrelid='business.personal_finance_observations'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%direction%';
 IF guard_count<>1 THEN RAISE EXCEPTION 'FINANCE_DIRECTION_CONSTRAINT_AMBIGUOUS'; END IF;
 EXECUTE format('ALTER TABLE business.personal_finance_observations DROP CONSTRAINT %I',guard_name);
END $migration$;
ALTER TABLE business.personal_finance_observations ADD CONSTRAINT personal_finance_observations_data_check CHECK (jsonb_typeof(data)='object' AND data ?& ARRAY['id','financialAccountId','importId','amountMinor','currency','direction','kind','status'] AND data->>'id'=id AND data->>'financialAccountId'=financial_account_id AND data->>'importId'=import_id AND jsonb_typeof(data->'amountMinor')='string' AND data->>'amountMinor' ~ '^(0|[1-9][0-9]*)$' AND data->>'currency' ~ '^[A-Z]{3}$' AND data->>'direction' IN ('debit','credit','neutral') AND data->>'kind' IN ('expense','income','transfer','refund','loan_drawdown','debt_payment','interest','fee','unknown') AND data->>'status' IN ('completed','pending','failed'));
