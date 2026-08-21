BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_upsert_schedule_student_override(
  p_tenant_id text,
  p_schedule_id text,
  p_student_id text,
  p_expected_updated_at timestamptz,
  p_attendance_status integer,
  p_tuition numeric,
  p_teacher_fee numeric
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  result_id text;
  result_updated_at timestamptz;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHEDULE_WRITER_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE business.schedules AS s
  SET updated_at=date_trunc('milliseconds', transaction_timestamp())
  WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.updated_at=p_expected_updated_at
  RETURNING s.id, s.updated_at INTO result_id, result_updated_at;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO business.schedule_student_overrides(
    tenant_id,schedule_id,student_id,attendance_status,tuition,teacher_fee
  ) VALUES (
    p_tenant_id,p_schedule_id,p_student_id,p_attendance_status,p_tuition,p_teacher_fee
  )
  ON CONFLICT (tenant_id, schedule_id, student_id) DO UPDATE
  SET attendance_status=EXCLUDED.attendance_status,
      tuition=EXCLUDED.tuition,
      teacher_fee=EXCLUDED.teacher_fee;

  id := result_id;
  updated_at := result_updated_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_upsert_schedule_student_override(text,text,text,timestamptz,integer,numeric,numeric) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_upsert_schedule_student_override(text,text,text,timestamptz,integer,numeric,numeric) TO vnext_pg17_writer;

COMMIT;
