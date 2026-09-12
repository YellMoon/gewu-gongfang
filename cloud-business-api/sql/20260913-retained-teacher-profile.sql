-- UTF-8: deleting a teaching-only profile retains its existing courses/lessons.
-- No account, grant, historic ownership, roster or financial snapshot is changed.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_teacher(
 p_tenant_id text,p_teacher_id text,p_expected_updated_at timestamptz
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE business.teachers t SET legacy_deleted=true,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',t.updated_at)+interval '1 millisecond')
  WHERE t.tenant_id=p_tenant_id AND t.id=p_teacher_id AND t.legacy_deleted=false AND t.updated_at=p_expected_updated_at RETURNING t.id,t.updated_at;
END;
$$;

-- A retained profile is usable only through an existing same-tenant course.
-- Profile CRUD and new course selection still use the live-only checker.
CREATE OR REPLACE FUNCTION business.vnext_check_retained_course_teacher(
 p_tenant text,p_course text,p_role text,p_actor text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE profile_id text; creator text; claimed boolean;
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant,NULL,p_role,p_actor);
 IF p_role='super_admin' AND p_actor IS NULL THEN RETURN true; END IF;
 SELECT t.id,t.created_by_teacher_id,t.account_claimed INTO profile_id,creator,claimed
  FROM business.courses c JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id
  WHERE c.tenant_id=p_tenant AND c.id=p_course FOR SHARE OF c FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_PROFILE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF profile_id=p_actor THEN RETURN true; END IF;
 IF creator IS DISTINCT FROM p_actor OR claimed THEN
  RAISE EXCEPTION 'VNEXT_TEACHER_PROFILE_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_check_retained_course_teacher(text,text,text,text) FROM PUBLIC;

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
  IF NOT business.vnext_teacher_student_access(p_tenant_id,checked_student_id,p_teacher_id) THEN
   IF NOT business.vnext_schedule_student_reference(p_tenant_id,COALESCE(p_course_id,current_course),checked_student_id) THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501';
   END IF;
  END IF;
 END LOOP;
 RETURN true;
END;
$$;

-- Keep the saved teacher name when editing the same course after profile deletion.
-- A deleted profile cannot be assigned to another course, even by an administrator.
CREATE OR REPLACE FUNCTION business.vnext_update_course_record_v1(
 p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz,p_name text,p_year integer,p_semester text,p_display_name text,p_course_type integer,p_source_type integer,p_institution_id text,p_price_tuition numeric,p_price_teacher numeric,p_billing_unit integer,p_teacher_fee_mode integer,p_room_id text,p_room_name text,p_teacher_id text,p_teacher_name text,p_active boolean,p_default_duration_minutes integer,p_notes text,p_pricings jsonb
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_room_name text; v_teacher_name text; previous_teacher text; previous_teacher_name text; pricing record;
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT c.teacher_id,c.teacher_name_snapshot INTO previous_teacher,previous_teacher_name FROM business.courses c
  WHERE c.tenant_id=p_tenant_id AND c.id=p_course_id AND c.legacy_deleted=false AND c.updated_at=p_expected_updated_at FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF jsonb_typeof(p_pricings)<>'array' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS x(student_id text,tuition numeric,teacher_fee numeric) GROUP BY x.student_id HAVING count(*)>1) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE='22023'; END IF;
 SELECT r.name INTO v_room_name FROM business.rooms r WHERE r.tenant_id=p_tenant_id AND r.id=p_room_id AND r.legacy_deleted=false;
 IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_ROOM_INVALID' USING ERRCODE='23503'; END IF;
 SELECT CASE WHEN t.legacy_deleted THEN previous_teacher_name ELSE t.name END INTO v_teacher_name FROM business.teachers t
  WHERE t.tenant_id=p_tenant_id AND t.id=p_teacher_id AND (t.legacy_deleted=false OR t.id=previous_teacher) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_TEACHER_INVALID' USING ERRCODE='23503'; END IF;
 IF p_institution_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business.institutions i WHERE i.tenant_id=p_tenant_id AND i.id=p_institution_id AND i.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_INSTITUTION_INVALID' USING ERRCODE='23503'; END IF;
 IF p_source_type IN (2,3) AND p_institution_id IS NULL THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_INSTITUTION_REQUIRED' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS x(student_id text,tuition numeric,teacher_fee numeric) LEFT JOIN business.students s ON s.tenant_id=p_tenant_id AND s.id=x.student_id AND s.legacy_deleted=false WHERE s.id IS NULL OR x.tuition IS NULL OR x.tuition<0 OR x.teacher_fee IS NULL OR x.teacher_fee<0) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_PRICINGS_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE business.courses c SET name=p_name,year=p_year,semester=p_semester,display_name=p_display_name,course_type=p_course_type,legacy_source_type=p_source_type,institution_id=p_institution_id,price_tuition=p_price_tuition,price_teacher=p_price_teacher,billing_unit=p_billing_unit,teacher_fee_mode=p_teacher_fee_mode,legacy_room_id=p_room_id,room_name_snapshot=v_room_name,teacher_id=p_teacher_id,teacher_name_snapshot=v_teacher_name,legacy_active=p_active,default_duration_minutes=p_default_duration_minutes,notes=p_notes,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',c.updated_at)+interval '1 millisecond')
  WHERE c.tenant_id=p_tenant_id AND c.id=p_course_id AND c.legacy_deleted=false AND c.updated_at=p_expected_updated_at RETURNING c.id,c.updated_at INTO id,updated_at;
 IF NOT FOUND THEN RETURN; END IF;
 -- Lesson address/fee changes remain separate, explicitly confirmed lesson commands.
 DELETE FROM business.course_student_pricings p WHERE p.tenant_id=p_tenant_id AND p.course_id=p_course_id;
 FOR pricing IN SELECT * FROM jsonb_to_recordset(p_pricings) AS x(student_id text,tuition numeric,teacher_fee numeric) LOOP
  INSERT INTO business.course_student_pricings(tenant_id,course_id,student_id,tuition,teacher_fee) VALUES(p_tenant_id,p_course_id,pricing.student_id,pricing.tuition,pricing.teacher_fee);
 END LOOP;
 RETURN NEXT;
END;
$$;
-- Existing function grants are preserved by CREATE OR REPLACE; private helper has no writer grant.
COMMIT;
