BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_create_institution_v1(p_tenant_id text,p_institution_id text,p_name text,p_contact_person text,p_contact_phone text,p_revenue_share numeric,p_notes text)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.institutions i WHERE i.tenant_id=p_tenant_id AND i.name=p_name AND i.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_NAME_EXISTS' USING ERRCODE='23505'; END IF;
  INSERT INTO business.institutions(id,tenant_id,name,contact_person_legacy,contact_phone_legacy,revenue_share,notes,legacy_deleted,created_at,updated_at)
  VALUES(p_institution_id,p_tenant_id,p_name,p_contact_person,p_contact_phone,p_revenue_share,p_notes,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.institutions.id,business.institutions.updated_at INTO id,updated_at; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_update_institution_v1(p_tenant_id text,p_institution_id text,p_expected_updated_at timestamptz,p_name text,p_contact_person text,p_contact_phone text,p_revenue_share numeric,p_notes text)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.institutions i WHERE i.tenant_id=p_tenant_id AND i.name=p_name AND i.id<>p_institution_id AND i.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_NAME_EXISTS' USING ERRCODE='23505'; END IF;
  UPDATE business.institutions AS target SET name=p_name,contact_person_legacy=p_contact_person,contact_phone_legacy=p_contact_phone,revenue_share=p_revenue_share,notes=p_notes,updated_at=date_trunc('milliseconds',transaction_timestamp())
  WHERE target.tenant_id=p_tenant_id AND target.id=p_institution_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at
  RETURNING target.id,target.updated_at INTO id,updated_at; IF NOT FOUND THEN RETURN; END IF; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_institution(p_tenant_id text,p_institution_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.courses c WHERE c.tenant_id=p_tenant_id AND c.institution_id=p_institution_id AND c.legacy_deleted=false)
    OR EXISTS (SELECT 1 FROM business.students s WHERE s.tenant_id=p_tenant_id AND s.institution_id=p_institution_id AND s.legacy_deleted=false) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_REFERENCED' USING ERRCODE='P0001';
  END IF;
  UPDATE business.institutions AS target SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
  WHERE target.tenant_id=p_tenant_id AND target.id=p_institution_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at
  RETURNING target.id,target.updated_at INTO id,updated_at; IF NOT FOUND THEN RETURN; END IF; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_create_school_v1(p_tenant_id text,p_school_id text,p_name text,p_count integer)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.schools s WHERE s.tenant_id=p_tenant_id AND s.name=p_name AND s.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_NAME_EXISTS' USING ERRCODE='23505'; END IF;
  INSERT INTO business.schools(id,tenant_id,name,legacy_count,legacy_deleted,created_at,updated_at)
  VALUES(p_school_id,p_tenant_id,p_name,p_count,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.schools.id,business.schools.updated_at INTO id,updated_at; RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_update_school_v1(p_tenant_id text,p_school_id text,p_expected_updated_at timestamptz,p_name text,p_count integer)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous_name text;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.schools s WHERE s.tenant_id=p_tenant_id AND s.name=p_name AND s.id<>p_school_id AND s.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_NAME_EXISTS' USING ERRCODE='23505'; END IF;
  SELECT target.name INTO previous_name FROM business.schools target WHERE target.tenant_id=p_tenant_id AND target.id=p_school_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE business.schools AS target SET name=p_name,legacy_count=p_count,updated_at=date_trunc('milliseconds',transaction_timestamp()) WHERE target.tenant_id=p_tenant_id AND target.id=p_school_id
  RETURNING target.id,target.updated_at INTO id,updated_at;
  IF previous_name<>p_name THEN UPDATE business.students SET school_legacy=p_name,updated_at=date_trunc('milliseconds',transaction_timestamp()) WHERE tenant_id=p_tenant_id AND school_legacy=previous_name AND legacy_deleted=false; END IF;
  RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_school(p_tenant_id text,p_school_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_name text;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT target.name INTO current_name FROM business.schools target WHERE target.tenant_id=p_tenant_id AND target.id=p_school_id AND target.legacy_deleted=false AND target.updated_at=p_expected_updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM business.students s WHERE s.tenant_id=p_tenant_id AND s.school_legacy=current_name AND s.legacy_deleted=false) THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_REFERENCED' USING ERRCODE='P0001'; END IF;
  UPDATE business.schools AS target SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp()) WHERE target.tenant_id=p_tenant_id AND target.id=p_school_id
  RETURNING target.id,target.updated_at INTO id,updated_at; RETURN NEXT;
END; $$;

REVOKE ALL ON FUNCTION business.vnext_create_institution_v1(text,text,text,text,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_institution_v1(text,text,timestamptz,text,text,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_institution(text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_school_v1(text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_school_v1(text,text,timestamptz,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_school(text,text,timestamptz) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_institution_v1(text,text,text,text,text,numeric,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_institution_v1(text,text,timestamptz,text,text,text,numeric,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_institution(text,text,timestamptz) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_school_v1(text,text,text,integer) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_school_v1(text,text,timestamptz,text,integer) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_school(text,text,timestamptz) TO vnext_pg17_writer;

COMMIT;
