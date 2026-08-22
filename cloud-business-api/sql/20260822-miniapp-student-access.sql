BEGIN;

ALTER TABLE business.miniapp_cloud_role_grants
  ADD COLUMN student_relationship text;

UPDATE business.miniapp_cloud_role_grants
  SET student_relationship='student'
  WHERE role='student' AND student_relationship IS NULL;

ALTER TABLE business.miniapp_cloud_role_grants
  ADD CONSTRAINT miniapp_cloud_role_grants_student_relationship_check CHECK (
    (role='student' AND student_relationship IN ('student','guardian'))
    OR (role<>'student' AND student_relationship IS NULL)
  );

CREATE FUNCTION business.miniapp_cloud_student_access_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.role <> 'student' OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('miniapp-student-access:' || NEW.profile_id, 19));

  IF NEW.student_relationship = 'student' AND EXISTS (
    SELECT 1
      FROM business.miniapp_cloud_role_grants AS existing
     WHERE existing.role='student'
       AND existing.status='active'
       AND existing.profile_id=NEW.profile_id
       AND existing.student_relationship='student'
       AND existing.account_id<>NEW.account_id
  ) THEN
    RAISE EXCEPTION 'VNEXT_STUDENT_ACCESS_SELF_CONFLICT' USING ERRCODE='P0001';
  END IF;

  IF NEW.student_relationship = 'guardian' AND (
    SELECT count(*)
      FROM business.miniapp_cloud_role_grants AS existing
     WHERE existing.role='student'
       AND existing.status='active'
       AND existing.profile_id=NEW.profile_id
       AND existing.student_relationship='guardian'
       AND existing.account_id<>NEW.account_id
  ) >= 2 THEN
    RAISE EXCEPTION 'VNEXT_STUDENT_ACCESS_GUARDIAN_LIMIT' USING ERRCODE='P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER miniapp_cloud_student_access_guard
  BEFORE INSERT OR UPDATE OF role,status,profile_id,student_relationship ON business.miniapp_cloud_role_grants
  FOR EACH ROW EXECUTE FUNCTION business.miniapp_cloud_student_access_guard();

REVOKE EXECUTE ON FUNCTION business.miniapp_cloud_student_access_guard() FROM PUBLIC;

COMMIT;
