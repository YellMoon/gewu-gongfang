-- UTF-8: explicit, versioned undo of a confirmed soft deletion. Ordinary updates stay unchanged.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;
CREATE OR REPLACE FUNCTION business.vnext_restore_scoped_schedule(
  p_tenant_id text,p_schedule_id text,p_expected_updated_at timestamptz,p_course_id text,p_start_at timestamptz,p_end_at timestamptz,
  p_recurring_rule text,p_status integer,p_room_display text,p_service_type integer,p_tuition numeric,
  p_teacher_fee numeric,p_notes text,p_pricings jsonb,p_actor_role text,p_teacher_id text,p_snapshot jsonb DEFAULT NULL
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original_course text;
BEGIN
  IF p_course_id IS NULL OR p_pricings IS NULL OR jsonb_typeof(p_pricings)<>'array' THEN
    RAISE EXCEPTION 'VNEXT_SCHEDULE_RESTORE_RECORD_REQUIRED' USING ERRCODE='22023';
  END IF;
  -- Resolve the actor/teacher lock before the schedule row, matching other scoped writes.
  PERFORM business.vnext_check_schedule_actor(p_tenant_id,NULL,p_course_id,NULL,p_actor_role,p_teacher_id);
  SELECT s.course_id INTO original_course FROM business.schedules s
    WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.legacy_deleted=true
      AND s.updated_at=p_expected_updated_at FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- A teacher cannot take another teacher's deleted lesson into their own course.
  PERFORM business.vnext_check_schedule_actor(p_tenant_id,NULL,original_course,NULL,p_actor_role,p_teacher_id);
  UPDATE business.schedules s SET legacy_deleted=false
    WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id;
  -- Within this same transaction the existing scope/roster/snapshot validators apply.
  -- Original trial students are visible again; unrelated students remain forbidden.
  SELECT * INTO id,updated_at FROM business.vnext_update_scoped_schedule(p_tenant_id,p_schedule_id,p_expected_updated_at,p_course_id,
    p_start_at,p_end_at,p_recurring_rule,p_status,p_room_display,p_service_type,p_tuition,p_teacher_fee,p_notes,p_pricings,p_actor_role,p_teacher_id,p_snapshot);
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_SCHEDULE_RESTORE_CONFLICT' USING ERRCODE='22023'; END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_restore_scoped_schedule(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_restore_scoped_schedule(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text,jsonb) TO vnext_pg17_writer;
COMMIT;
