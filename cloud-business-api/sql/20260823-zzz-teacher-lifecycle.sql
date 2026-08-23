BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_create_teacher_v1(
  p_tenant_id text,p_teacher_id text,p_name text,p_phone text,p_subject text,p_hourly_rate numeric,p_notes text
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  INSERT INTO business.teachers(id,tenant_id,name,phone_legacy,subject,hourly_rate,notes,legacy_deleted,created_at,updated_at)
  VALUES (p_teacher_id,p_tenant_id,p_name,p_phone,p_subject,p_hourly_rate,p_notes,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.teachers.id,business.teachers.updated_at INTO id,updated_at;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_teacher_v1(
  p_tenant_id text,p_teacher_id text,p_expected_updated_at timestamptz,p_name text,p_phone text,p_subject text,p_hourly_rate numeric,p_notes text
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  UPDATE business.teachers
     SET name=p_name,phone_legacy=p_phone,subject=p_subject,hourly_rate=p_hourly_rate,notes=p_notes,
         updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE tenant_id=p_tenant_id AND id=p_teacher_id AND legacy_deleted=false AND updated_at=p_expected_updated_at
  RETURNING business.teachers.id,business.teachers.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_teacher(
  p_tenant_id text,p_teacher_id text,p_expected_updated_at timestamptz
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.courses WHERE tenant_id=p_tenant_id AND teacher_id=p_teacher_id AND legacy_deleted=false) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_REFERENCED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE business.teachers SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE tenant_id=p_tenant_id AND id=p_teacher_id AND legacy_deleted=false AND updated_at=p_expected_updated_at
  RETURNING business.teachers.id,business.teachers.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_create_teacher_v1(text,text,text,text,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_teacher_v1(text,text,timestamptz,text,text,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_teacher(text,text,timestamptz) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_teacher_v1(text,text,text,text,text,numeric,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_teacher_v1(text,text,timestamptz,text,text,text,numeric,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_teacher(text,text,timestamptz) TO vnext_pg17_writer;

COMMIT;
