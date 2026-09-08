BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- Restore the existing 20260827 lifecycle rule inside the scoped writer.
-- Tombstones retain their historical relations; completed courses are not tombstones.
CREATE OR REPLACE FUNCTION business.vnext_delete_scoped_student(p_tenant text,p_student text,p_expected timestamptz,p_role text,p_teacher text)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT business.vnext_check_student_actor(p_tenant,p_student,p_role,p_teacher) THEN RETURN; END IF;
  PERFORM 1 FROM business.students s WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.updated_at=p_expected;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM business.course_student_pricings p
    JOIN business.courses c ON c.tenant_id=p.tenant_id AND c.id=p.course_id AND c.legacy_deleted=false
    WHERE p.tenant_id=p_tenant AND p.student_id=p_student
  ) OR EXISTS (
    SELECT 1 FROM business.schedule_student_overrides o
    JOIN business.schedules s ON s.tenant_id=o.tenant_id AND s.id=o.schedule_id AND s.legacy_deleted=false
    WHERE o.tenant_id=p_tenant AND o.student_id=p_student
  ) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_REFERENCED' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY UPDATE business.students s SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
    WHERE s.tenant_id=p_tenant AND s.id=p_student AND s.legacy_deleted=false AND s.updated_at=p_expected RETURNING s.id,s.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_delete_scoped_student(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_student(text,text,timestamptz,text,text) TO vnext_pg17_writer;
COMMIT;
