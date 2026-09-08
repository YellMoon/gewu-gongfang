BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- UTF-8: match the original desktop deleteStudent operation: remove the student
-- from active records, without cascading into courses, attendance or finances.
-- Account scope, row locks and optimistic concurrency remain cloud-authoritative.
CREATE OR REPLACE FUNCTION business.vnext_delete_scoped_student(p_tenant text,p_student text,p_expected timestamptz,p_role text,p_teacher text)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_student_actor(p_tenant,p_student,p_role,p_teacher) THEN RETURN; END IF;
  RETURN QUERY UPDATE business.students s SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
    WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false AND s.updated_at=p_expected RETURNING s.id,s.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_delete_scoped_student(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_student(text,text,timestamptz,text,text) TO vnext_pg17_writer;
COMMIT;
