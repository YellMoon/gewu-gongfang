-- UTF-8: preserve original teacher fields while disambiguating columns from RETURNS TABLE variables.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_update_teacher_v1(
  p_tenant_id text,p_teacher_id text,p_expected_updated_at timestamptz,p_name text,p_phone text,p_subject text,p_hourly_rate numeric,p_notes text
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_TEACHER_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  UPDATE business.teachers AS t
     SET name=p_name,phone_legacy=p_phone,subject=p_subject,hourly_rate=p_hourly_rate,notes=p_notes,
         updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE t.tenant_id=p_tenant_id AND t.id=p_teacher_id AND t.legacy_deleted=false AND t.updated_at=p_expected_updated_at
  RETURNING t.id,t.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_update_teacher_v1(text,text,timestamptz,text,text,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_update_teacher_v1(text,text,timestamptz,text,text,text,numeric,text) TO vnext_pg17_writer;
COMMIT;
