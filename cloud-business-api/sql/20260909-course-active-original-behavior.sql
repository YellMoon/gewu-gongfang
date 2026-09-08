BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- UTF-8: preserve the original finish/reopen action without revalidating or replacing old enrolments.
CREATE OR REPLACE FUNCTION business.vnext_set_scoped_course_active(
  p_tenant_id text,p_course_id text,p_expected_updated_at timestamptz,p_active boolean,
  p_actor_role text,p_actor_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_course_actor(p_tenant_id,p_course_id,p_actor_teacher_id,ARRAY[]::text[],p_actor_role,p_actor_teacher_id);
  IF p_active IS NULL THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COURSE_STATE_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE business.courses c
    SET legacy_active=p_active,updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',c.updated_at)+interval '1 millisecond')
    WHERE c.tenant_id=p_tenant_id AND c.id=p_course_id AND c.legacy_deleted=false AND c.updated_at=p_expected_updated_at
    RETURNING c.id,c.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_set_scoped_course_active(text,text,timestamptz,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_set_scoped_course_active(text,text,timestamptz,boolean,text,text) TO vnext_pg17_writer;
COMMIT;
