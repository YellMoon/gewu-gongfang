BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

ALTER TABLE business.students ADD COLUMN created_by_teacher_id text;
ALTER TABLE business.students ADD CONSTRAINT students_creator_teacher_tenant_fk
  FOREIGN KEY (tenant_id,created_by_teacher_id) REFERENCES business.teachers(tenant_id,id);
CREATE INDEX students_creator_teacher_idx ON business.students(tenant_id,created_by_teacher_id)
  WHERE legacy_deleted=false AND created_by_teacher_id IS NOT NULL;

-- Existing enrolments remain valid. New records need no invented course to
-- establish their creator's access. Hold the evidence through the transaction.
CREATE FUNCTION business.vnext_teacher_student_access(p_tenant text,p_student text,p_teacher text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE creator text;
BEGIN
  SELECT s.created_by_teacher_id INTO creator FROM business.students s
    WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF creator=p_teacher THEN RETURN true; END IF;
  PERFORM 1 FROM business.course_student_pricings p JOIN business.courses c ON c.tenant_id=p.tenant_id AND c.id=p.course_id
    WHERE p.tenant_id=p_tenant AND p.student_id=p_student AND c.teacher_id=p_teacher AND c.legacy_deleted=false
    ORDER BY c.id LIMIT 1 FOR SHARE OF p,c;
  IF FOUND THEN RETURN true; END IF;
  PERFORM 1 FROM business.schedule_student_overrides o
    JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id
    JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
    WHERE o.tenant_id=p_tenant AND o.student_id=p_student AND c.teacher_id=p_teacher
      AND c.legacy_deleted=false AND s.legacy_deleted=false
    ORDER BY c.id,s.id LIMIT 1 FOR SHARE OF o,s,c;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION business.vnext_check_student_actor(p_tenant text,p_student text,p_role text,p_teacher text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_role='super_admin' AND p_teacher IS NULL THEN
    IF p_student IS NULL THEN RETURN true; END IF;
    PERFORM 1 FROM business.students s WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false FOR UPDATE;
    RETURN FOUND;
  END IF;
  IF p_role IS DISTINCT FROM 'teacher' OR p_teacher IS NULL OR p_teacher='' OR btrim(p_teacher)<>p_teacher THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_STUDENT_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('teacher-schedule:'||p_tenant||':'||p_teacher,0));
  PERFORM 1 FROM business.teachers t WHERE t.tenant_id=p_tenant AND t.id=p_teacher AND t.legacy_deleted=false FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_STUDENT_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF p_student IS NULL THEN RETURN true; END IF;
  -- Acquire an exclusive row lock before access evidence to avoid two shared
  -- teachers both upgrading the same student lock during an edit.
  PERFORM 1 FROM business.students s WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false FOR UPDATE;
  IF NOT FOUND OR NOT business.vnext_teacher_student_access(p_tenant,p_student,p_teacher) THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_STUDENT_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION business.vnext_create_scoped_student(
  p_tenant text,p_student text,p_name text,p_school text,p_grade_year integer,p_grade_current text,
  p_institution text,p_parent text,p_notes text,p_source_type integer,p_source text,p_contacts jsonb,p_role text,p_teacher text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_student_actor(p_tenant,NULL,p_role,p_teacher);
  SELECT x.id,x.updated_at INTO id,updated_at FROM business.vnext_create_student_record_v1(
    p_tenant,p_student,p_name,p_school,p_grade_year,p_grade_current,p_institution,p_parent,p_notes,p_source_type,p_source,NULL,p_contacts) x;
  IF p_role='teacher' THEN
    UPDATE business.students s SET created_by_teacher_id=p_teacher WHERE s.tenant_id=p_tenant AND s.id=p_student;
  END IF;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION business.vnext_update_scoped_student_record(
  p_tenant text,p_student text,p_expected timestamptz,p_name text,p_school text,p_grade_year integer,p_grade_current text,
  p_institution text,p_parent text,p_notes text,p_source_type integer,p_source text,p_contacts jsonb,p_role text,p_teacher text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_student_actor(p_tenant,p_student,p_role,p_teacher) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM business.vnext_update_student_record_v4(p_tenant,p_student,p_expected,p_name,p_school,
    p_grade_year,p_grade_current,p_institution,p_parent,p_notes,p_source_type,p_source,p_contacts);
END;
$$;

CREATE FUNCTION business.vnext_update_scoped_student(
  p_tenant text,p_student text,p_expected timestamptz,p_name text,p_school text,p_grade_year integer,p_grade_current text,
  p_institution text,p_parent text,p_notes text,p_source_type integer,p_source text,p_role text,p_teacher text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_student_actor(p_tenant,p_student,p_role,p_teacher) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM business.vnext_update_student_v2(p_tenant,p_student,p_expected,p_name,p_school,
    p_grade_year,p_grade_current,p_institution,p_parent,p_notes,p_source_type,p_source);
END;
$$;

CREATE FUNCTION business.vnext_delete_scoped_student(p_tenant text,p_student text,p_expected timestamptz,p_role text,p_teacher text)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_student_actor(p_tenant,p_student,p_role,p_teacher) THEN RETURN; END IF;
  PERFORM 1 FROM business.students s WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.updated_at=p_expected;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM business.course_student_pricings p WHERE p.tenant_id=p_tenant AND p.student_id=p_student)
    OR EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id=p_tenant AND o.student_id=p_student) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_REFERENCED' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY UPDATE business.students s SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
    WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false AND s.updated_at=p_expected RETURNING s.id,s.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_check_course_actor(
  p_tenant_id text,p_existing_course_id text,p_requested_teacher_id text,p_student_ids text[],p_actor_role text,p_actor_teacher_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE student_key text;
BEGIN
  IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_actor_role='super_admin' AND p_actor_teacher_id IS NULL THEN RETURN true; END IF;
  IF p_actor_role IS DISTINCT FROM 'teacher' OR p_actor_teacher_id IS NULL OR p_actor_teacher_id=''
    OR btrim(p_actor_teacher_id)<>p_actor_teacher_id OR p_requested_teacher_id IS DISTINCT FROM p_actor_teacher_id THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('teacher-schedule:'||p_tenant_id||':'||p_actor_teacher_id,0));
  PERFORM 1 FROM business.teachers t WHERE t.tenant_id=p_tenant_id AND t.id=p_actor_teacher_id AND t.legacy_deleted=false FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF p_existing_course_id IS NOT NULL THEN
    PERFORM 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=p_existing_course_id
      AND c.teacher_id=p_actor_teacher_id AND c.legacy_deleted=false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
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
  IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_actor_role='super_admin' AND p_teacher_id IS NULL THEN
    IF p_schedule_id IS NOT NULL THEN
      PERFORM 1 FROM business.schedules s WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.legacy_deleted=false FOR UPDATE;
      RETURN FOUND;
    END IF;
    RETURN true;
  END IF;
  IF p_actor_role IS DISTINCT FROM 'teacher' OR p_teacher_id IS NULL OR p_teacher_id='' OR btrim(p_teacher_id)<>p_teacher_id THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('teacher-schedule:'||p_tenant_id||':'||p_teacher_id,0));
  PERFORM 1 FROM business.teachers t WHERE t.tenant_id=p_tenant_id AND t.id=p_teacher_id AND t.legacy_deleted=false FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF p_schedule_id IS NOT NULL THEN
    SELECT s.course_id INTO current_course FROM business.schedules s WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.legacy_deleted=false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  END IF;
  IF current_course IS NULL AND p_course_id IS NULL THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  FOR checked_course_id IN SELECT DISTINCT x FROM unnest(ARRAY[current_course,p_course_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=checked_course_id AND c.teacher_id=p_teacher_id AND c.legacy_deleted=false FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  END LOOP;
  FOR checked_student_id IN SELECT DISTINCT x FROM unnest(p_student_ids) x ORDER BY x LOOP
    IF NOT business.vnext_teacher_student_access(p_tenant_id,checked_student_id,p_teacher_id) THEN
      RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501';
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_teacher_student_access(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_check_course_actor(text,text,text,text[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_check_schedule_actor(text,text,text,text[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_check_student_actor(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_student(text,text,text,text,integer,text,text,text,text,integer,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_student_record(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_student(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_scoped_student(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_student(text,text,text,text,integer,text,text,text,text,integer,text,jsonb,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_student_record(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text,jsonb,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_student(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_student(text,text,timestamptz,text,text) TO vnext_pg17_writer;
COMMIT;
