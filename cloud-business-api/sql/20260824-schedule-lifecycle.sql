BEGIN;

GRANT SELECT,INSERT,UPDATE,DELETE ON business.schedules TO vnext_pg17_business_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON business.schedule_student_overrides TO vnext_pg17_business_owner;

SET LOCAL ROLE vnext_pg17_business_owner;

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
  IF NOT EXISTS (SELECT 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.id=p_course_id AND c.legacy_deleted=false) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_COURSE_INVALID' USING ERRCODE = '23503';
  END IF;
  IF jsonb_typeof(p_pricings) <> 'array' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric) GROUP BY student_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric)
    LEFT JOIN business.students s ON s.tenant_id=p_tenant_id AND s.id=x.student_id AND s.legacy_deleted=false
    WHERE s.id IS NULL OR x.attendance_status NOT IN (1,3,4) OR x.tuition IS NULL OR x.tuition<0 OR x.teacher_fee IS NULL OR x.teacher_fee<0
  ) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023'; END IF;
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

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_schedule(p_tenant_id text,p_schedule_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  UPDATE business.schedules AS target SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
  WHERE target.tenant_id=p_tenant_id AND target.id=p_schedule_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at
  RETURNING target.id,target.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_create_schedule_record_v1(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_schedule(text,text,timestamptz) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_schedule_record_v1(text,text,text,timestamptz,timestamptz,text,integer,text,integer,numeric,numeric,text,jsonb) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_schedule(text,text,timestamptz) TO vnext_pg17_writer;

COMMIT;
