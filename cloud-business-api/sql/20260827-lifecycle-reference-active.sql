BEGIN;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_student(
  p_tenant_id text,p_student_id text,p_expected_updated_at timestamptz
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM business.course_student_pricings AS pricing
    JOIN business.courses AS course_record ON course_record.tenant_id=pricing.tenant_id AND course_record.id=pricing.course_id AND course_record.legacy_deleted=false
    WHERE pricing.tenant_id=p_tenant_id AND pricing.student_id=p_student_id
  ) OR EXISTS (
    SELECT 1 FROM business.schedule_student_overrides AS override_record
    JOIN business.schedules AS schedule_record ON schedule_record.tenant_id=override_record.tenant_id AND schedule_record.id=override_record.schedule_id AND schedule_record.legacy_deleted=false
    WHERE override_record.tenant_id=p_tenant_id AND override_record.student_id=p_student_id
  ) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_REFERENCED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE business.students AS target SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
  WHERE target.tenant_id=p_tenant_id AND target.id=p_student_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at
  RETURNING target.id,target.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_course(p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM business.schedules AS schedule_record
    WHERE schedule_record.tenant_id=p_tenant_id AND schedule_record.course_id=p_course_id AND schedule_record.legacy_deleted=false
  ) OR EXISTS (
    SELECT 1 FROM business.schedule_student_overrides AS override_record
    JOIN business.schedules AS schedule_record ON schedule_record.tenant_id=override_record.tenant_id AND schedule_record.id=override_record.schedule_id AND schedule_record.legacy_deleted=false
    WHERE override_record.tenant_id=p_tenant_id AND schedule_record.course_id=p_course_id
  ) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_REFERENCED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE business.courses AS target SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
  WHERE target.tenant_id=p_tenant_id AND target.id=p_course_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at
  RETURNING target.id,target.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_soft_delete_student(text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_course(text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_student(text,text,timestamptz) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_course(text,text,timestamptz) TO vnext_pg17_writer;

COMMIT;
