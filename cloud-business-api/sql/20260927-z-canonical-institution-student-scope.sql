-- Correct the earlier scope expansion without rewriting any business data.
-- Institution membership permits selecting its canonical billing student for a
-- course/lesson; standalone student CRUD retains its previous relationship guard.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

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
   AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.account_claimed=false))
  ORDER BY c.id LIMIT 1 FOR SHARE OF p,c,t;
 IF FOUND THEN RETURN true; END IF;
 PERFORM 1 FROM business.schedule_student_overrides o
  JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id
  JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
  JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
  WHERE o.tenant_id=p_tenant AND o.student_id=p_student AND c.legacy_deleted=false AND s.legacy_deleted=false
   AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.account_claimed=false))
  ORDER BY c.id,s.id LIMIT 1 FOR SHARE OF o,s,c,t;
 RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_teacher_institution_billing_access(p_tenant text,p_student text,p_teacher text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE institution_key text; creator text;
BEGIN
 PERFORM 1 FROM business.teachers actor
  WHERE actor.tenant_id=p_tenant AND actor.id=p_teacher AND actor.legacy_deleted=false FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT b.institution_id INTO institution_key FROM business.institution_billing_students b
  WHERE b.tenant_id=p_tenant AND b.student_id=p_student;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Match institution rename's parent -> mapping -> student lock order. Recheck
 -- each relationship after locking; the initial lookup is not authorization.
 SELECT i.created_by_teacher_id INTO creator FROM business.institutions i
  WHERE i.tenant_id=p_tenant AND i.id=institution_key AND i.legacy_deleted=false FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM business.institution_billing_students b
  WHERE b.tenant_id=p_tenant AND b.institution_id=institution_key AND b.student_id=p_student FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM business.students s
  WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.institution_id=institution_key
   AND s.legacy_deleted=false AND s.legacy_is_institution_student FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF creator=p_teacher THEN RETURN true; END IF;
 -- Hold course ownership and profile-claim evidence until the mutation commits.
 PERFORM 1 FROM business.courses c
  JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
  WHERE c.tenant_id=p_tenant AND c.institution_id=institution_key AND c.legacy_deleted=false
   AND (c.teacher_id=p_teacher OR (t.created_by_teacher_id=p_teacher AND t.account_claimed=false))
  ORDER BY c.id LIMIT 1 FOR SHARE OF c,t;
 RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_check_course_actor(
 p_tenant_id text,p_existing_course_id text,p_requested_teacher_id text,p_student_ids text[],p_actor_role text,p_actor_teacher_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE student_key text; existing_teacher text;
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant_id,NULL,p_actor_role,p_actor_teacher_id);
 IF p_actor_role='super_admin' AND p_actor_teacher_id IS NULL THEN RETURN true; END IF;
 IF p_requested_teacher_id IS NULL THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_existing_course_id IS NOT NULL THEN
  SELECT c.teacher_id INTO existing_teacher FROM business.courses c
   WHERE c.tenant_id=p_tenant_id AND c.id=p_existing_course_id AND c.legacy_deleted=false FOR UPDATE;
  IF NOT FOUND OR existing_teacher IS NULL THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  PERFORM business.vnext_check_retained_course_teacher(p_tenant_id,p_existing_course_id,p_actor_role,p_actor_teacher_id);
 END IF;
 IF p_existing_course_id IS NULL OR p_requested_teacher_id IS DISTINCT FROM existing_teacher THEN
  PERFORM business.vnext_check_teaching_profile(p_tenant_id,p_requested_teacher_id,p_actor_role,p_actor_teacher_id);
 END IF;
 FOR student_key IN SELECT DISTINCT x FROM unnest(p_student_ids) x ORDER BY x LOOP
  IF business.vnext_teacher_institution_billing_access(p_tenant_id,student_key,p_actor_teacher_id) THEN CONTINUE; END IF;
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
DECLARE current_course text; checked_course_id text; checked_student_id text;
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
  PERFORM business.vnext_check_retained_course_teacher(p_tenant_id,checked_course_id,p_actor_role,p_teacher_id);
 END LOOP;
 FOR checked_student_id IN SELECT DISTINCT x FROM unnest(p_student_ids) x ORDER BY x LOOP
  IF business.vnext_teacher_institution_billing_access(p_tenant_id,checked_student_id,p_teacher_id) THEN CONTINUE; END IF;
  IF NOT business.vnext_teacher_student_access(p_tenant_id,checked_student_id,p_teacher_id) THEN
   IF NOT business.vnext_schedule_student_reference(p_tenant_id,COALESCE(p_course_id,current_course),checked_student_id) THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501';
   END IF;
  END IF;
 END LOOP;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_teacher_student_access(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_teacher_institution_billing_access(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_check_course_actor(text,text,text,text[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_check_schedule_actor(text,text,text,text[],text,text) FROM PUBLIC;
COMMIT;
