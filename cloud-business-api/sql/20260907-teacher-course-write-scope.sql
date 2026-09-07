BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- Preserve the existing reference and optimistic-version checks, but qualify
-- columns so the RETURNS TABLE id variable cannot shadow the schedule/course id.
CREATE OR REPLACE FUNCTION business.vnext_soft_delete_course(p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.schedules s WHERE s.tenant_id=p_tenant_id AND s.course_id=p_course_id)
    OR EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id=p_tenant_id
      AND o.schedule_id IN (SELECT s.id FROM business.schedules s WHERE s.tenant_id=p_tenant_id AND s.course_id=p_course_id)) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_REFERENCED' USING ERRCODE='P0001';
  END IF;
  UPDATE business.courses c SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
    WHERE c.tenant_id=p_tenant_id AND c.id=p_course_id AND c.legacy_deleted=false AND c.updated_at=p_expected_updated_at
    RETURNING c.id,c.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_check_course_actor(
  p_tenant_id text,p_existing_course_id text,p_requested_teacher_id text,p_student_ids text[],
  p_actor_role text,p_actor_teacher_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE student_key text;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_actor_role='super_admin' AND p_actor_teacher_id IS NULL THEN RETURN true; END IF;
  IF p_actor_role IS DISTINCT FROM 'teacher' OR p_actor_teacher_id IS NULL
    OR p_actor_teacher_id='' OR btrim(p_actor_teacher_id)<>p_actor_teacher_id
    OR p_requested_teacher_id IS DISTINCT FROM p_actor_teacher_id THEN
    RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  -- Same lock namespace as schedule writes: course membership and ownership
  -- cannot change between a teacher's authorization and mutation.
  PERFORM pg_advisory_xact_lock(hashtextextended('teacher-schedule:'||p_tenant_id||':'||p_actor_teacher_id,0));
  PERFORM 1 FROM business.teachers t WHERE t.tenant_id=p_tenant_id AND t.id=p_actor_teacher_id
    AND t.legacy_deleted=false FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF p_existing_course_id IS NOT NULL THEN
    PERFORM 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=p_existing_course_id
      AND c.teacher_id=p_actor_teacher_id AND c.legacy_deleted=false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  END IF;
  FOR student_key IN SELECT DISTINCT x FROM unnest(p_student_ids) x ORDER BY x LOOP
    PERFORM 1 FROM business.students st
      JOIN business.course_student_pricings p ON p.tenant_id=st.tenant_id AND p.student_id=st.id
      JOIN business.courses c ON c.tenant_id=p.tenant_id AND c.id=p.course_id
      WHERE st.tenant_id=p_tenant_id AND st.id=student_key AND st.legacy_deleted=false
        AND c.teacher_id=p_actor_teacher_id AND c.legacy_deleted=false
      ORDER BY c.id LIMIT 1 FOR SHARE OF st,p,c;
    IF NOT FOUND THEN
      PERFORM 1 FROM business.students st
        JOIN business.schedule_student_overrides o ON o.tenant_id=st.tenant_id AND o.student_id=st.id
        JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id
        JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
        WHERE st.tenant_id=p_tenant_id AND st.id=student_key AND st.legacy_deleted=false
          AND c.teacher_id=p_actor_teacher_id AND c.legacy_deleted=false AND s.legacy_deleted=false
        ORDER BY c.id,s.id LIMIT 1 FOR SHARE OF st,o,s,c;
      IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_COURSE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_create_scoped_course(
  p_tenant_id text,p_course_id text,p_name text,p_year integer,p_semester text,p_display_name text,
  p_course_type integer,p_source_type integer,p_institution_id text,p_price_tuition numeric,p_price_teacher numeric,
  p_billing_unit integer,p_teacher_fee_mode integer,p_room_id text,p_room_name text,p_teacher_id text,p_teacher_name text,
  p_active boolean,p_default_duration_minutes integer,p_notes text,p_pricings jsonb,p_actor_role text,p_actor_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_course_actor(p_tenant_id,NULL,p_teacher_id,
    ARRAY(SELECT x.student_id FROM jsonb_to_recordset(p_pricings) AS x(student_id text)),p_actor_role,p_actor_teacher_id);
  RETURN QUERY SELECT * FROM business.vnext_create_course_record_v1(p_tenant_id,p_course_id,p_name,p_year,p_semester,p_display_name,
    p_course_type,p_source_type,p_institution_id,p_price_tuition,p_price_teacher,p_billing_unit,p_teacher_fee_mode,p_room_id,p_room_name,
    p_teacher_id,p_teacher_name,p_active,p_default_duration_minutes,p_notes,p_pricings);
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_scoped_course(
  p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz,p_name text,p_year integer,p_semester text,p_display_name text,
  p_course_type integer,p_source_type integer,p_institution_id text,p_price_tuition numeric,p_price_teacher numeric,
  p_billing_unit integer,p_teacher_fee_mode integer,p_room_id text,p_room_name text,p_teacher_id text,p_teacher_name text,
  p_active boolean,p_default_duration_minutes integer,p_notes text,p_pricings jsonb,p_actor_role text,p_actor_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_course_actor(p_tenant_id,p_course_id,p_teacher_id,
    ARRAY(SELECT x.student_id FROM jsonb_to_recordset(p_pricings) AS x(student_id text)),p_actor_role,p_actor_teacher_id);
  RETURN QUERY SELECT * FROM business.vnext_update_course_record_v1(p_tenant_id,p_course_id,p_expected_updated_at,p_name,p_year,p_semester,p_display_name,
    p_course_type,p_source_type,p_institution_id,p_price_tuition,p_price_teacher,p_billing_unit,p_teacher_fee_mode,p_room_id,p_room_name,
    p_teacher_id,p_teacher_name,p_active,p_default_duration_minutes,p_notes,p_pricings);
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_delete_scoped_course(
  p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz,p_actor_role text,p_actor_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_course_actor(p_tenant_id,p_course_id,p_actor_teacher_id,ARRAY[]::text[],p_actor_role,p_actor_teacher_id);
  RETURN QUERY SELECT * FROM business.vnext_soft_delete_course(p_tenant_id,p_course_id,p_expected_updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_create_scoped_room(
  p_tenant_id text,p_room_id text,p_name text,p_address text,p_actor_role text,p_actor_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_course_actor(p_tenant_id,NULL,p_actor_teacher_id,ARRAY[]::text[],p_actor_role,p_actor_teacher_id);
  RETURN QUERY SELECT * FROM business.vnext_create_room_v1(p_tenant_id,p_room_id,p_name,p_address);
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_check_course_actor(text,text,text,text[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_course(text,text,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_course(text,text,timestamptz,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_scoped_course(text,text,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_room(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_course(text,text,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_course(text,text,timestamptz,text,integer,text,text,integer,integer,text,numeric,numeric,integer,integer,text,text,text,text,boolean,integer,text,jsonb,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_course(text,text,timestamptz,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_room(text,text,text,text,text,text) TO vnext_pg17_writer;
COMMIT;
