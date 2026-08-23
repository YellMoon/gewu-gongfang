BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_update_student_v2(
  p_tenant_id text,
  p_student_id text,
  p_expected_updated_at timestamptz,
  p_name text,
  p_school text,
  p_grade_year integer,
  p_grade_current text,
  p_institution_id text,
  p_parent_name text,
  p_notes text,
  p_legacy_source_type integer,
  p_student_source text
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_WRITER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE business.students AS s
     SET name=p_name,
         school_legacy=p_school,
         grade_year=p_grade_year,
         grade_current=p_grade_current,
         institution_id=p_institution_id,
         parent_name_legacy=p_parent_name,
         notes=p_notes,
         legacy_source_type=p_legacy_source_type,
         student_source_legacy=p_student_source,
         updated_at=date_trunc('milliseconds', transaction_timestamp())
   WHERE s.tenant_id=p_tenant_id
     AND s.id=p_student_id
     AND s.legacy_deleted=false
     AND s.updated_at=p_expected_updated_at
  RETURNING s.id,s.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_update_student_v2(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_student_v2(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text) TO vnext_pg17_writer;

COMMIT;
