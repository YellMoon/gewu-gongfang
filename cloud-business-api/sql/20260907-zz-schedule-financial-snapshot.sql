-- UTF-8: additive historical snapshots; never infer old values from today's course.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;
ALTER TABLE business.schedules
  ADD COLUMN IF NOT EXISTS billing_unit integer CHECK (billing_unit IN (1,2)),
  ADD COLUMN IF NOT EXISTS teacher_fee_mode integer CHECK (teacher_fee_mode IN (1,2)),
  ADD COLUMN IF NOT EXISTS teacher_id text,
  ADD COLUMN IF NOT EXISTS teacher_name text;

CREATE OR REPLACE FUNCTION business.vnext_apply_schedule_financial_snapshot(
  p_tenant_id text,p_schedule_id text,p_snapshot jsonb,p_actor_role text,p_actor_teacher text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE requested_teacher text;
BEGIN
  IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_snapshot IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(p_snapshot)<>'object' OR NOT (p_snapshot ?& ARRAY['billingUnit','teacherFeeMode','teacherId','teacherName'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_snapshot) k WHERE k NOT IN ('billingUnit','teacherFeeMode','teacherId','teacherName'))
    OR NOT (p_snapshot->'billingUnit' IN ('null'::jsonb,'1'::jsonb,'2'::jsonb))
    OR NOT (p_snapshot->'teacherFeeMode' IN ('null'::jsonb,'1'::jsonb,'2'::jsonb))
    OR jsonb_typeof(p_snapshot->'teacherId') NOT IN ('null','string')
    OR jsonb_typeof(p_snapshot->'teacherName') NOT IN ('null','string')
    OR length(p_snapshot->>'teacherId')>256 OR (p_snapshot->>'teacherId')=''
    OR btrim(p_snapshot->>'teacherId') IS DISTINCT FROM (p_snapshot->>'teacherId')
    OR length(p_snapshot->>'teacherName')>4096
    OR btrim(p_snapshot->>'teacherName') IS DISTINCT FROM (p_snapshot->>'teacherName') THEN
    RAISE EXCEPTION 'VNEXT_SCHEDULE_SNAPSHOT_INVALID' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM business.schedules s
    WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_SCHEDULE_SNAPSHOT_INVALID' USING ERRCODE='23503'; END IF;
  requested_teacher=p_snapshot->>'teacherId';
  -- Ownership is checked by the scoped caller, not by the historical teacher
  -- snapshot. Copying an old lesson after course reassignment must retain it.
  IF requested_teacher IS NOT NULL THEN
    -- An archived teacher remains a valid historical snapshot, but another tenant never does.
    PERFORM 1 FROM business.teachers t WHERE t.tenant_id=p_tenant_id AND t.id=requested_teacher FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_SCHEDULE_SNAPSHOT_TEACHER_INVALID' USING ERRCODE='23503'; END IF;
  END IF;
  UPDATE business.schedules s SET billing_unit=(p_snapshot->>'billingUnit')::integer,
    teacher_fee_mode=(p_snapshot->>'teacherFeeMode')::integer,
    teacher_id=requested_teacher,teacher_name=p_snapshot->>'teacherName'
    WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_apply_schedule_financial_snapshot(text,text,jsonb,text,text) FROM PUBLIC;

-- Replace the former signatures; omitted final arguments remain valid for older clients.
DROP FUNCTION IF EXISTS business.vnext_create_scoped_schedule(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text);
DROP FUNCTION IF EXISTS business.vnext_update_scoped_schedule(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text);
CREATE OR REPLACE FUNCTION business.vnext_create_scoped_schedule(
  p_tenant_id text,p_schedule_id text,p_course_id text,p_start_at timestamptz,p_end_at timestamptz,
  p_recurring_rule text,p_status integer,p_room_display text,p_service_type integer,p_tuition numeric,
  p_teacher_fee numeric,p_notes text,p_pricings jsonb,p_actor_role text,p_teacher_id text,p_snapshot jsonb DEFAULT NULL
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_schedule_actor(p_tenant_id,NULL,p_course_id,
    ARRAY(SELECT x.student_id FROM jsonb_to_recordset(p_pricings) AS x(student_id text)),p_actor_role,p_teacher_id);
  SELECT * INTO id,updated_at FROM business.vnext_create_schedule_record_v1(p_tenant_id,p_schedule_id,p_course_id,
    p_start_at,p_end_at,p_recurring_rule,p_status,p_room_display,p_service_type,p_tuition,p_teacher_fee,p_notes,p_pricings);
  PERFORM business.vnext_apply_schedule_financial_snapshot(p_tenant_id,p_schedule_id,p_snapshot,p_actor_role,p_teacher_id);
  RETURN NEXT;
END;
$$;
CREATE OR REPLACE FUNCTION business.vnext_update_scoped_schedule(
  p_tenant_id text,p_schedule_id text,p_expected_updated_at timestamptz,p_course_id text,p_start_at timestamptz,p_end_at timestamptz,
  p_recurring_rule text,p_status integer,p_room_display text,p_service_type integer,p_tuition numeric,
  p_teacher_fee numeric,p_notes text,p_pricings jsonb,p_actor_role text,p_teacher_id text,p_snapshot jsonb DEFAULT NULL
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_schedule_actor(p_tenant_id,p_schedule_id,p_course_id,
    ARRAY(SELECT x.student_id FROM jsonb_to_recordset(p_pricings) AS x(student_id text)),p_actor_role,p_teacher_id) THEN RETURN; END IF;
  SELECT * INTO id,updated_at FROM business.vnext_update_schedule_record_v3(p_tenant_id,p_schedule_id,p_expected_updated_at,p_course_id,
    p_start_at,p_end_at,p_recurring_rule,p_status,p_room_display,p_service_type,p_tuition,p_teacher_fee,p_notes,p_pricings);
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM business.vnext_apply_schedule_financial_snapshot(p_tenant_id,p_schedule_id,p_snapshot,p_actor_role,p_teacher_id);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_schedule(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_schedule(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_schedule(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text,jsonb) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_schedule(text,text,timestamptz,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb,text,text,jsonb) TO vnext_pg17_writer;
COMMIT;
