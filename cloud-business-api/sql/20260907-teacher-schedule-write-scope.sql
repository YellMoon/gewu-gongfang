BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- REST credentials are resolved by the cloud service; these functions also hold
-- the ownership and enrolment rows until the mutation transaction finishes.
CREATE OR REPLACE FUNCTION business.vnext_check_schedule_actor(
  p_tenant_id text, p_schedule_id text, p_course_id text, p_student_ids text[],
  p_actor_role text, p_teacher_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_course text;
  checked_course_id text;
  checked_student_id text;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_WRITER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_actor_role='super_admin' AND p_teacher_id IS NULL THEN
    -- The override function predates soft deletion. Never let it edit a deleted
    -- schedule, including for an administrator; return the usual conflict.
    IF p_schedule_id IS NOT NULL THEN
      PERFORM 1 FROM business.schedules s WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id
        AND s.legacy_deleted=false FOR UPDATE;
      RETURN FOUND;
    END IF;
    RETURN true;
  END IF;
  IF p_actor_role IS DISTINCT FROM 'teacher' OR p_teacher_id IS NULL
    OR p_teacher_id='' OR btrim(p_teacher_id)<>p_teacher_id THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  -- Serialize one teacher's writes before locking schedules/enrolments. Different
  -- teachers remain independent; all grants below are function-only.
  PERFORM pg_advisory_xact_lock(hashtextextended('teacher-schedule:' || p_tenant_id || ':' || p_teacher_id,0));
  PERFORM 1 FROM business.teachers t WHERE t.tenant_id=p_tenant_id AND t.id=p_teacher_id
    AND t.legacy_deleted=false FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF p_schedule_id IS NOT NULL THEN
    SELECT s.course_id INTO current_course FROM business.schedules s
      WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.legacy_deleted=false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  END IF;
  IF current_course IS NULL AND p_course_id IS NULL THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  FOR checked_course_id IN SELECT DISTINCT x FROM unnest(ARRAY[current_course,p_course_id]) x WHERE x IS NOT NULL ORDER BY x
  LOOP
    PERFORM 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=checked_course_id
      AND c.teacher_id=p_teacher_id AND c.legacy_deleted=false FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  END LOOP;
  FOR checked_student_id IN SELECT DISTINCT x FROM unnest(p_student_ids) x ORDER BY x
  LOOP
    -- Match the teacher read projection: a course enrolment OR a student already
    -- admitted to one of this teacher's schedules (including a trial lesson).
    PERFORM 1 FROM business.students st
      JOIN business.course_student_pricings p ON p.tenant_id=st.tenant_id AND p.student_id=st.id
      JOIN business.courses c ON c.tenant_id=p.tenant_id AND c.id=p.course_id
      WHERE st.tenant_id=p_tenant_id AND st.id=checked_student_id AND st.legacy_deleted=false
        AND c.teacher_id=p_teacher_id AND c.legacy_deleted=false
      ORDER BY c.id LIMIT 1 FOR SHARE OF st,p,c;
    IF NOT FOUND THEN
      PERFORM 1 FROM business.students st
        JOIN business.schedule_student_overrides o ON o.tenant_id=st.tenant_id AND o.student_id=st.id
        JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id
        JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
        WHERE st.tenant_id=p_tenant_id AND st.id=checked_student_id AND st.legacy_deleted=false
          AND c.teacher_id=p_teacher_id AND c.legacy_deleted=false AND s.legacy_deleted=false
        ORDER BY c.id,s.id LIMIT 1 FOR SHARE OF st,o,s,c;
      IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_create_scoped_schedule(
  p_tenant_id text,p_schedule_id text,p_course_id text,p_start_at timestamptz,p_end_at timestamptz,
  p_recurring_rule text,p_status integer,p_room_display text,p_service_type integer,p_tuition numeric,
  p_teacher_fee numeric,p_notes text,p_pricings jsonb,p_actor_role text,p_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_schedule_actor(p_tenant_id,NULL,p_course_id,
    ARRAY(SELECT x.student_id FROM jsonb_to_recordset(p_pricings) AS x(student_id text)),p_actor_role,p_teacher_id);
  RETURN QUERY SELECT * FROM business.vnext_create_schedule_record_v1(p_tenant_id,p_schedule_id,p_course_id,
    p_start_at,p_end_at,p_recurring_rule,p_status,p_room_display,p_service_type,p_tuition,p_teacher_fee,p_notes,p_pricings);
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_scoped_schedule(
  p_tenant_id text,p_schedule_id text,p_expected_updated_at timestamptz,p_course_id text,p_start_at timestamptz,p_end_at timestamptz,
  p_recurring_rule text,p_status integer,p_room_display text,p_service_type integer,p_tuition numeric,
  p_teacher_fee numeric,p_notes text,p_pricings jsonb,p_actor_role text,p_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_schedule_actor(p_tenant_id,p_schedule_id,p_course_id,
    ARRAY(SELECT x.student_id FROM jsonb_to_recordset(p_pricings) AS x(student_id text)),p_actor_role,p_teacher_id) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM business.vnext_update_schedule_record_v3(p_tenant_id,p_schedule_id,p_expected_updated_at,p_course_id,
    p_start_at,p_end_at,p_recurring_rule,p_status,p_room_display,p_service_type,p_tuition,p_teacher_fee,p_notes,p_pricings);
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_delete_scoped_schedule(
  p_tenant_id text,p_schedule_id text,p_expected_updated_at timestamptz,p_actor_role text,p_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_schedule_actor(p_tenant_id,p_schedule_id,NULL,NULL,p_actor_role,p_teacher_id) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM business.vnext_soft_delete_schedule(p_tenant_id,p_schedule_id,p_expected_updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_upsert_scoped_schedule_student(
  p_tenant_id text,p_schedule_id text,p_student_id text,p_expected_updated_at timestamptz,
  p_attendance_status integer,p_tuition numeric,p_teacher_fee numeric,p_actor_role text,p_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_schedule_actor(p_tenant_id,p_schedule_id,NULL,ARRAY[p_student_id],p_actor_role,p_teacher_id) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM business.vnext_upsert_schedule_student_override(p_tenant_id,p_schedule_id,p_student_id,p_expected_updated_at,
    p_attendance_status,p_tuition,p_teacher_fee);
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_check_schedule_actor(text,text,text,text[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_schedule(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_schedule(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_scoped_schedule(text,text,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_upsert_scoped_schedule_student(text,text,text,timestamptz,integer,numeric,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_schedule(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_schedule(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_schedule(text,text,timestamptz,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_upsert_scoped_schedule_student(text,text,text,timestamptz,integer,numeric,numeric,text,text) TO vnext_pg17_writer;
COMMIT;
