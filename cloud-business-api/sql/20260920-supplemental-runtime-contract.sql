BEGIN;

-- Existing cloud-only supplemental mutations validate live references. They
-- need these three columns, not student names, contact details or core writes.
GRANT SELECT (id, tenant_id, legacy_deleted) ON TABLE business.students TO vnext_pg17_writer;
GRANT SELECT (id, tenant_id, legacy_deleted) ON TABLE business.schedules TO vnext_pg17_writer;
GRANT SELECT (tenant_id, account_id, category_id, category_type)
  ON TABLE business.personal_asset_categories TO vnext_pg17_writer;

-- The existing REST contract returns millisecond timestamps. Preserve that
-- externally observed baseline for old rows and advance it on every write,
-- including two writes in one transaction. No business values are rewritten.
CREATE OR REPLACE FUNCTION business.vnext_supplemental_version_ms_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := date_trunc('milliseconds', NEW.updated_at);
  ELSE
    NEW.updated_at := GREATEST(
      date_trunc('milliseconds', NEW.updated_at),
      date_trunc('milliseconds', OLD.updated_at) + interval '1 millisecond'
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_supplemental_version_ms_v1() FROM PUBLIC;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'payments', 'consumptions', 'grades',
    'personal_asset_manual_categories', 'personal_asset_manual_records'
  ] LOOP
    EXECUTE format(
      'UPDATE business.%I SET updated_at=date_trunc(''milliseconds'',updated_at) '
      'WHERE updated_at<>date_trunc(''milliseconds'',updated_at)', table_name
    );
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER vnext_supplemental_version_ms_v1 '
      'BEFORE INSERT OR UPDATE ON business.%I FOR EACH ROW '
      'EXECUTE FUNCTION business.vnext_supplemental_version_ms_v1()', table_name
    );
  END LOOP;
END;
$$;

COMMIT;
