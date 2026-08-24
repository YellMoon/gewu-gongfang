BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_update_schedule_record_v2(
  p_tenant_id text,
  p_schedule_id text,
  p_expected_updated_at timestamptz,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status integer,
  p_room_display text,
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
  IF p_pricings IS NOT NULL AND EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(p_pricings) AS x(student_id text,attendance_status integer,tuition numeric,teacher_fee numeric)
      LEFT JOIN business.students s ON s.tenant_id=p_tenant_id AND s.id=x.student_id AND s.legacy_deleted=false
     WHERE s.id IS NULL OR x.attendance_status NOT IN (1,3,4)
        OR x.tuition IS NULL OR x.tuition<0 OR x.teacher_fee IS NULL OR x.teacher_fee<0
  ) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_PRICINGS_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE business.schedules AS target
     SET start_at=p_start_at,
         end_at=p_end_at,
         status=p_status,
         room_display_snapshot=p_room_display,
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

REVOKE ALL ON FUNCTION business.vnext_update_schedule_record_v2(text,text,timestamptz,timestamptz,timestamptz,integer,text,numeric,numeric,text,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_schedule_record_v2(text,text,timestamptz,timestamptz,timestamptz,integer,text,numeric,numeric,text,jsonb) TO vnext_pg17_writer;

COMMIT;
