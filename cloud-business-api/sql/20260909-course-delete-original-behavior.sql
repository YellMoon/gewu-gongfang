BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- UTF-8: original deleteCourse removes only the course, never its lessons or finances.
-- The existing scoped entry point still checks the actor and locks its evidence.
CREATE OR REPLACE FUNCTION business.vnext_soft_delete_course(p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  UPDATE business.courses c SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
    WHERE c.tenant_id=p_tenant_id AND c.id=p_course_id AND c.legacy_deleted=false AND c.updated_at=p_expected_updated_at
    RETURNING c.id,c.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_course(text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_course(text,text,timestamptz) TO vnext_pg17_writer;
COMMIT;
