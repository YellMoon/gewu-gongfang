BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

-- Do not merge or rewrite historical duplicates. Deployment must stop and report
-- them if present; successful installation protects all school-writing paths.
CREATE UNIQUE INDEX schools_active_tenant_name_unique
  ON business.schools (tenant_id, name) WHERE legacy_deleted=false;

CREATE FUNCTION business.vnext_register_student_school()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- Only an already-authorized cloud business command has this side effect.
  -- Owner-led imports/restores must retain their exact historical contents.
  IF session_user <> 'vnext_pg17_writer' OR NEW.legacy_deleted
     OR NEW.school_legacy IS NULL OR btrim(NEW.school_legacy) = '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO business.schools
    (id, tenant_id, name, legacy_count, legacy_deleted, created_at, updated_at)
  VALUES
    (gen_random_uuid()::text, NEW.tenant_id, NEW.school_legacy, 1, false,
     date_trunc('milliseconds', transaction_timestamp()),
     date_trunc('milliseconds', transaction_timestamp()))
  ON CONFLICT (tenant_id, name) WHERE legacy_deleted=false DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_register_student_school() FROM PUBLIC;
CREATE TRIGGER vnext_student_school_registration
  AFTER INSERT OR UPDATE OF school_legacy ON business.students
  FOR EACH ROW EXECUTE FUNCTION business.vnext_register_student_school();

COMMIT;
