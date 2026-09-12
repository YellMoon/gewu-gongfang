-- UTF-8: teaching-only profiles do not provision accounts or grants. No historical ownership is inferred.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;
ALTER TABLE business.teachers ADD COLUMN IF NOT EXISTS created_by_teacher_id text;
-- A business-only claim marker avoids exposing the account/grant directory to the read-only business role.
-- Once claimed, revoking/removing a grant must not hand the profile back to its original creator.
ALTER TABLE business.teachers ADD COLUMN IF NOT EXISTS account_claimed boolean NOT NULL DEFAULT false;
UPDATE business.teachers t SET account_claimed=true WHERE t.account_claimed=false
 AND EXISTS (SELECT 1 FROM business.miniapp_cloud_role_grants g WHERE g.profile_type='teacher' AND g.profile_id=t.id);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='business.teachers'::regclass AND conname='teachers_creator_tenant_fk') THEN
  ALTER TABLE business.teachers ADD CONSTRAINT teachers_creator_tenant_fk
   FOREIGN KEY (tenant_id,created_by_teacher_id) REFERENCES business.teachers(tenant_id,id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS teachers_creator_idx ON business.teachers(tenant_id,created_by_teacher_id)
 WHERE created_by_teacher_id IS NOT NULL AND legacy_deleted=false;

-- Serialize claiming/rebinding with scoped profile writes, including insertion of a previously absent grant.
CREATE OR REPLACE FUNCTION business.vnext_lock_teacher_profile_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old_id text; new_id text; profile_key text;
BEGIN
 IF TG_OP<>'INSERT' AND OLD.profile_type='teacher' THEN old_id:=OLD.profile_id; END IF;
 IF TG_OP<>'DELETE' AND NEW.profile_type='teacher' THEN new_id:=NEW.profile_id; END IF;
 FOR profile_key IN SELECT DISTINCT x FROM unnest(ARRAY[old_id,new_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
  UPDATE business.teachers t SET account_claimed=true WHERE t.id=profile_key;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS managed_teacher_claim_lock ON business.miniapp_cloud_role_grants;
CREATE TRIGGER managed_teacher_claim_lock BEFORE INSERT OR UPDATE OR DELETE ON business.miniapp_cloud_role_grants
 FOR EACH ROW EXECUTE FUNCTION business.vnext_lock_teacher_profile_claim();

CREATE OR REPLACE FUNCTION business.vnext_check_teaching_profile(
 p_tenant text,p_profile text,p_role text,p_actor text,p_allow_self boolean DEFAULT true
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE creator text; claimed boolean;
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_role='super_admin' AND p_actor IS NULL THEN RETURN true; END IF;
 IF p_role IS DISTINCT FROM 'teacher' OR p_actor IS NULL OR p_actor='' OR btrim(p_actor)<>p_actor THEN
  RAISE EXCEPTION 'VNEXT_TEACHER_PROFILE_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('teacher-schedule:'||p_tenant||':'||p_actor,0));
 PERFORM 1 FROM business.teachers t WHERE t.tenant_id=p_tenant AND t.id=p_actor AND t.legacy_deleted=false FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_PROFILE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_profile IS NULL THEN RETURN true; END IF;
 SELECT t.created_by_teacher_id,t.account_claimed INTO creator,claimed FROM business.teachers t
  WHERE t.tenant_id=p_tenant AND t.id=p_profile AND t.legacy_deleted=false FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_PROFILE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_profile=p_actor AND p_allow_self THEN RETURN true; END IF;
 IF creator IS DISTINCT FROM p_actor OR p_profile=p_actor OR claimed THEN
  RAISE EXCEPTION 'VNEXT_TEACHER_PROFILE_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_create_scoped_teacher(
 p_tenant text,p_id text,p_name text,p_phone text,p_subject text,p_rate numeric,p_notes text,p_role text,p_actor text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant,NULL,p_role,p_actor);
 RETURN QUERY SELECT * FROM business.vnext_create_teacher_v1(p_tenant,p_id,p_name,p_phone,p_subject,p_rate,p_notes);
 UPDATE business.teachers t SET created_by_teacher_id=CASE WHEN p_role='teacher' THEN p_actor ELSE NULL END
  WHERE t.tenant_id=p_tenant AND t.id=p_id;
END;
$$;
CREATE OR REPLACE FUNCTION business.vnext_update_scoped_teacher(
 p_tenant text,p_id text,p_expected timestamptz,p_name text,p_phone text,p_subject text,p_rate numeric,p_notes text,p_role text,p_actor text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant,p_id,p_role,p_actor);
 RETURN QUERY UPDATE business.teachers t SET name=p_name,phone_legacy=p_phone,subject=p_subject,hourly_rate=p_rate,notes=p_notes,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',t.updated_at)+interval '1 millisecond')
  WHERE t.tenant_id=p_tenant AND t.id=p_id AND t.legacy_deleted=false AND t.updated_at=p_expected RETURNING t.id,t.updated_at;
END;
$$;
-- Keep the original referenced-course protection; qualify the existing function's output-column names.
CREATE OR REPLACE FUNCTION business.vnext_soft_delete_teacher(
 p_tenant_id text,p_teacher_id text,p_expected_updated_at timestamptz
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.teacher_id=p_teacher_id AND c.legacy_deleted=false) THEN
  RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_REFERENCED' USING ERRCODE='P0001';
 END IF;
 RETURN QUERY UPDATE business.teachers t SET legacy_deleted=true,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',t.updated_at)+interval '1 millisecond')
  WHERE t.tenant_id=p_tenant_id AND t.id=p_teacher_id AND t.legacy_deleted=false AND t.updated_at=p_expected_updated_at RETURNING t.id,t.updated_at;
END;
$$;
CREATE OR REPLACE FUNCTION business.vnext_delete_scoped_teacher(
 p_tenant text,p_id text,p_expected timestamptz,p_role text,p_actor text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant,p_id,p_role,p_actor,false);
 RETURN QUERY SELECT * FROM business.vnext_soft_delete_teacher(p_tenant,p_id,p_expected);
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_lock_teacher_profile_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_check_teaching_profile(text,text,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_teacher(text,text,text,text,text,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_teacher(text,text,timestamptz,text,text,text,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_scoped_teacher(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_teacher(text,text,text,text,text,numeric,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_teacher(text,text,timestamptz,text,text,text,numeric,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_teacher(text,text,timestamptz,text,text) TO vnext_pg17_writer;

-- Use the same live, unclaimed relationship for enrolled students. Hold the profile row
-- so a concurrent account claim cannot invalidate the evidence during this transaction.
CREATE OR REPLACE FUNCTION business.vnext_teacher_student_access(p_tenant text,p_student text,p_teacher text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE creator text;
BEGIN
 SELECT s.created_by_teacher_id INTO creator FROM business.students s
  WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF creator=p_teacher THEN RETURN true; END IF;
 PERFORM 1 FROM business.course_student_pricings p
  JOIN business.courses c ON c.tenant_id=p.tenant_id AND c.id=p.course_id
  JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
  WHERE p.tenant_id=p_tenant AND p.student_id=p_student AND c.legacy_deleted=false
   AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.legacy_deleted=false AND t.account_claimed=false))
  ORDER BY c.id LIMIT 1 FOR SHARE OF p,c,t;
 IF FOUND THEN RETURN true; END IF;
 PERFORM 1 FROM business.schedule_student_overrides o
  JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id
  JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
  JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
  WHERE o.tenant_id=p_tenant AND o.student_id=p_student AND c.legacy_deleted=false AND s.legacy_deleted=false
   AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.legacy_deleted=false AND t.account_claimed=false))
  ORDER BY c.id,s.id LIMIT 1 FOR SHARE OF o,s,c,t;
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_teacher_student_access(text,text,text) FROM PUBLIC;

-- Keep course/student/version semantics; extend only the checked teacher profile relationship.
CREATE OR REPLACE FUNCTION business.vnext_check_course_actor(
 p_tenant_id text,p_existing_course_id text,p_requested_teacher_id text,p_student_ids text[],p_actor_role text,p_actor_teacher_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE student_key text; existing_teacher text;
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant_id,p_requested_teacher_id,p_actor_role,p_actor_teacher_id);
 IF p_actor_role='super_admin' AND p_actor_teacher_id IS NULL THEN RETURN true; END IF;
 IF p_requested_teacher_id IS NULL THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_existing_course_id IS NOT NULL THEN
  SELECT c.teacher_id INTO existing_teacher FROM business.courses c
   WHERE c.tenant_id=p_tenant_id AND c.id=p_existing_course_id AND c.legacy_deleted=false FOR UPDATE;
  IF NOT FOUND OR existing_teacher IS NULL THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  PERFORM business.vnext_check_teaching_profile(p_tenant_id,existing_teacher,p_actor_role,p_actor_teacher_id);
 END IF;
 FOR student_key IN SELECT DISTINCT x FROM unnest(p_student_ids) x ORDER BY x LOOP
  IF NOT business.vnext_teacher_student_access(p_tenant_id,student_key,p_actor_teacher_id) THEN
   RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
 END LOOP;
 RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION business.vnext_check_schedule_actor(
 p_tenant_id text,p_schedule_id text,p_course_id text,p_student_ids text[],p_actor_role text,p_teacher_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_course text; checked_course_id text; checked_student_id text; course_teacher text;
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant_id,NULL,p_actor_role,p_teacher_id);
 IF p_actor_role='super_admin' AND p_teacher_id IS NULL THEN
  IF p_schedule_id IS NOT NULL THEN
   PERFORM 1 FROM business.schedules s WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.legacy_deleted=false FOR UPDATE;
   RETURN FOUND;
  END IF;
  RETURN true;
 END IF;
 IF p_schedule_id IS NOT NULL THEN
  SELECT s.course_id INTO current_course FROM business.schedules s
   WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.legacy_deleted=false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 END IF;
 IF current_course IS NULL AND p_course_id IS NULL THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 FOR checked_course_id IN SELECT DISTINCT x FROM unnest(ARRAY[current_course,p_course_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
  SELECT c.teacher_id INTO course_teacher FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=checked_course_id FOR SHARE;
  IF NOT FOUND OR course_teacher IS NULL THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  PERFORM business.vnext_check_teaching_profile(p_tenant_id,course_teacher,p_actor_role,p_teacher_id);
 END LOOP;
 FOR checked_student_id IN SELECT DISTINCT x FROM unnest(p_student_ids) x ORDER BY x LOOP
  IF NOT business.vnext_teacher_student_access(p_tenant_id,checked_student_id,p_teacher_id) THEN
   IF NOT business.vnext_schedule_student_reference(p_tenant_id,COALESCE(p_course_id,current_course),checked_student_id) THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501';
   END IF;
  END IF;
 END LOOP;
 RETURN true;
END;
$$;
COMMIT;
