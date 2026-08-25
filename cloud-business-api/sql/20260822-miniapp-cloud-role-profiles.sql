BEGIN;

ALTER TABLE business.miniapp_cloud_role_grants
  ADD COLUMN profile_type text,
  ADD COLUMN profile_id text;

ALTER TABLE business.miniapp_cloud_role_grants
  ADD CONSTRAINT miniapp_cloud_role_grants_profile_check CHECK (
    (role IN ('teacher','student') AND profile_type=role AND profile_id IS NOT NULL AND profile_id=btrim(profile_id) AND profile_id <> '')
    OR (role='super_admin' AND profile_type IS NULL AND profile_id IS NULL)
  );

CREATE UNIQUE INDEX miniapp_cloud_one_active_role
  ON business.miniapp_cloud_role_grants(account_id)
  WHERE status='active';

CREATE FUNCTION business.miniapp_cloud_role_grant_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.role='teacher' AND NOT EXISTS (
    SELECT 1 FROM business.teachers
     WHERE id=NEW.profile_id AND legacy_deleted=false
  ) THEN
    RAISE EXCEPTION 'CLOUD_MINIAPP_PROFILE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF NEW.role='student' AND NOT EXISTS (
    SELECT 1 FROM business.students
     WHERE id=NEW.profile_id AND legacy_deleted=false
  ) THEN
    RAISE EXCEPTION 'CLOUD_MINIAPP_PROFILE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER miniapp_cloud_role_grant_profile_guard
  BEFORE INSERT OR UPDATE ON business.miniapp_cloud_role_grants
  FOR EACH ROW EXECUTE FUNCTION business.miniapp_cloud_role_grant_profile_guard();

REVOKE EXECUTE ON FUNCTION business.miniapp_cloud_role_grant_profile_guard() FROM PUBLIC;

COMMIT;
