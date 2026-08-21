BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_update_schedule(
  p_tenant_id text,
  p_schedule_id text,
  p_expected_updated_at timestamptz,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status integer,
  p_room_display text,
  p_tuition numeric,
  p_teacher_fee numeric,
  p_notes text
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
  SET start_at=p_start_at,
      end_at=p_end_at,
      status=p_status,
      room_display_snapshot=p_room_display,
      calculated_tuition=p_tuition,
      calculated_teacher_fee=p_teacher_fee,
      notes=p_notes,
      updated_at=date_trunc('milliseconds', transaction_timestamp())
  WHERE s.tenant_id=p_tenant_id AND s.id=p_schedule_id AND s.updated_at=p_expected_updated_at
  RETURNING s.id, s.updated_at INTO result_id, result_updated_at;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  id := result_id;
  updated_at := result_updated_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_update_schedule(text,text,timestamptz,timestamptz,timestamptz,integer,text,numeric,numeric,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_schedule(text,text,timestamptz,timestamptz,timestamptz,integer,text,numeric,numeric,text) TO vnext_pg17_writer;

COMMIT;
