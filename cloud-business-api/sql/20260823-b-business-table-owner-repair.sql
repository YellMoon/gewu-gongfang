BEGIN;

-- On historical instances, an earlier bootstrap created business relations
-- under the runtime database owner.  This runs as that owner exactly once and
-- transfers every table or partitioned table in the business schema.
RESET ROLE;
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='business'
      AND c.relkind IN ('r','p')
      AND pg_get_userbyid(c.relowner)=current_user
  LOOP
    EXECUTE format('ALTER TABLE business.%I OWNER TO vnext_pg17_business_owner', item.relname);
  END LOOP;
END $$;

COMMIT;
