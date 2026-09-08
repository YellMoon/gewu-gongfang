-- UTF-8: preserve original lesson operations after student deletion, not student CRUD.
-- Forward-only; same-course retained relationships, tenant boundaries and row locks.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_schedule_student_reference(p_tenant text,p_course text,p_student text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM 1 FROM business.students st
    JOIN business.course_student_pricings p ON p.tenant_id=st.tenant_id AND p.student_id=st.id
    WHERE st.tenant_id=p_tenant AND st.id=p_student AND p.course_id=p_course
    FOR SHARE OF st,p;
  IF FOUND THEN RETURN true; END IF;
  PERFORM 1 FROM business.students st
    JOIN business.schedule_student_overrides o ON o.tenant_id=st.tenant_id AND o.student_id=st.id
    JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id
    WHERE st.tenant_id=p_tenant AND st.id=p_student AND s.course_id=p_course AND s.legacy_deleted=false
    ORDER BY s.id LIMIT 1 FOR SHARE OF st,o,s;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_schedule_pricing_student_valid(p_tenant text,p_course text,p_student text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE deleted boolean;
BEGIN
  SELECT st.legacy_deleted INTO deleted FROM business.students st
    WHERE st.tenant_id=p_tenant AND st.id=p_student FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF deleted=false THEN RETURN true; END IF;
  RETURN business.vnext_schedule_student_reference(p_tenant,p_course,p_student);
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_schedule_student_reference(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_schedule_pricing_student_valid(text,text,text) FROM PUBLIC;

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
    PERFORM 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=checked_course_id AND c.teacher_id=p_teacher_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_TEACHER_SCHEDULE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION business.vnext_create_schedule_record_v1(
  p_tenant_id text,p_schedule_id text,p_course_id text,p_start_at timestamptz,p_end_at timestamptz,
  p_recurring_rule text,p_status integer,p_room_display text,p_service_type integer,p_tuition numeric,
  p_teacher_fee numeric,p_notes text,p_pricings jsonb
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE pricing record;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=p_course_id) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_COURSE_INVALID' USING ERRCODE = '23503';
  END IF;
  IF jsonb_typeof(p_pricings) <> 'array' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric) GROUP BY student_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023';
  END IF;
  FOR pricing IN SELECT * FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric) ORDER BY student_id LOOP
    IF NOT business.vnext_schedule_pricing_student_valid(p_tenant_id,p_course_id,pricing.student_id)
      OR pricing.attendance_status NOT IN (1,3,4) OR pricing.tuition IS NULL OR pricing.tuition<0 OR pricing.teacher_fee IS NULL OR pricing.teacher_fee<0 THEN
      RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE='22023';
    END IF;
  END LOOP;
  INSERT INTO business.schedules(id,tenant_id,course_id,start_at,end_at,recurring_rule_json,status,room_display_snapshot,service_type,calculated_tuition,calculated_teacher_fee,notes,legacy_deleted,created_at,updated_at)
  VALUES (p_schedule_id,p_tenant_id,p_course_id,p_start_at,p_end_at,p_recurring_rule,p_status,p_room_display,p_service_type,p_tuition,p_teacher_fee,p_notes,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.schedules.id,business.schedules.updated_at INTO id,updated_at;
  FOR pricing IN SELECT * FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric)
  LOOP
    INSERT INTO business.schedule_student_overrides(tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee)
    VALUES (p_tenant_id,p_schedule_id,pricing.student_id,pricing.attendance_status,pricing.tuition,pricing.teacher_fee);
  END LOOP;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_schedule_record_v3(
  p_tenant_id text,
  p_schedule_id text,
  p_expected_updated_at timestamptz,
  p_course_id text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_recurring_rule text,
  p_status integer,
  p_room_display text,
  p_service_type integer,
  p_tuition numeric,
  p_teacher_fee numeric,
  p_notes text,
  p_pricings jsonb
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pricing record;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_WRITER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business.courses AS course
     WHERE course.tenant_id=p_tenant_id AND course.id=p_course_id
  ) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_COURSE_INVALID' USING ERRCODE = '23503';
  END IF;
  IF p_course_id IS NOT NULL AND p_service_type IS NOT NULL AND p_service_type NOT IN (1,2) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_SERVICE_TYPE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_pricings IS NOT NULL AND jsonb_typeof(p_pricings) <> 'array' THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_pricings IS NOT NULL AND EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric)
     GROUP BY student_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_pricings IS NOT NULL THEN
    FOR pricing IN SELECT * FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric) ORDER BY student_id LOOP
      IF NOT business.vnext_schedule_pricing_student_valid(p_tenant_id,
        COALESCE(p_course_id,(SELECT s.course_id FROM business.schedules s WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id)),pricing.student_id)
        OR pricing.attendance_status NOT IN (1,3,4) OR pricing.tuition IS NULL OR pricing.tuition<0 OR pricing.teacher_fee IS NULL OR pricing.teacher_fee<0 THEN
        RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;

  UPDATE business.schedules AS target
     SET course_id=CASE WHEN p_course_id IS NULL THEN target.course_id ELSE p_course_id END,
         start_at=p_start_at,
         end_at=p_end_at,
         recurring_rule_json=CASE WHEN p_course_id IS NULL THEN target.recurring_rule_json ELSE p_recurring_rule END,
         status=p_status,
         room_display_snapshot=p_room_display,
         service_type=CASE WHEN p_course_id IS NULL THEN target.service_type ELSE p_service_type END,
         calculated_tuition=p_tuition,
         calculated_teacher_fee=p_teacher_fee,
         notes=p_notes,
         updated_at=date_trunc('milliseconds', transaction_timestamp())
   WHERE target.tenant_id=p_tenant_id AND target.id=p_schedule_id
     AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at
  RETURNING target.id,target.updated_at INTO id,updated_at;

  IF NOT FOUND THEN RETURN; END IF;

  IF p_pricings IS NOT NULL THEN
    DELETE FROM business.schedule_student_overrides
     WHERE tenant_id=p_tenant_id AND schedule_id=p_schedule_id;
    FOR pricing IN
      SELECT * FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric)
    LOOP
      INSERT INTO business.schedule_student_overrides(
        tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee
      ) VALUES (
        p_tenant_id,p_schedule_id,pricing.student_id,pricing.attendance_status,pricing.tuition,pricing.teacher_fee
      );
    END LOOP;
  END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_check_schedule_actor(text,text,text,text[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_schedule_record_v1(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_schedule_record_v3(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb) FROM PUBLIC;
COMMIT;
