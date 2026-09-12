-- UTF-8: creator scope for new institutions; never infer historical ownership or cascade deletion.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;
ALTER TABLE business.institutions ADD COLUMN IF NOT EXISTS created_by_teacher_id text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='business.institutions'::regclass AND conname='institutions_creator_tenant_fk') THEN
  ALTER TABLE business.institutions ADD CONSTRAINT institutions_creator_tenant_fk
   FOREIGN KEY (tenant_id,created_by_teacher_id) REFERENCES business.teachers(tenant_id,id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS institutions_creator_idx ON business.institutions(tenant_id,created_by_teacher_id)
 WHERE created_by_teacher_id IS NOT NULL AND legacy_deleted=false;

CREATE OR REPLACE FUNCTION business.vnext_check_institution_actor(p_tenant text,p_id text,p_role text,p_actor text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE creator text;
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant,NULL,p_role,p_actor);
 IF p_role='super_admin' AND p_actor IS NULL THEN RETURN true; END IF;
 IF p_id IS NULL THEN RETURN true; END IF;
 SELECT i.created_by_teacher_id INTO creator FROM business.institutions i
  WHERE i.tenant_id=p_tenant AND i.id=p_id AND i.legacy_deleted=false FOR UPDATE;
 IF NOT FOUND OR creator IS DISTINCT FROM p_actor THEN
  RAISE EXCEPTION 'VNEXT_TEACHER_INSTITUTION_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_create_scoped_institution(
 p_tenant text,p_id text,p_name text,p_contact text,p_phone text,p_share numeric,p_notes text,p_role text,p_actor text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_institution_actor(p_tenant,NULL,p_role,p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('institution-name:'||p_tenant||':'||p_name,0));
 RETURN QUERY SELECT * FROM business.vnext_create_institution_v1(p_tenant,p_id,p_name,p_contact,p_phone,p_share,p_notes);
 IF p_role='teacher' THEN
  UPDATE business.institutions i SET created_by_teacher_id=p_actor WHERE i.tenant_id=p_tenant AND i.id=p_id;
  -- Only the billing student generated/linked in this creation transaction acquires the creator.
  UPDATE business.students s SET created_by_teacher_id=p_actor
   FROM business.institution_billing_students b
   WHERE b.tenant_id=p_tenant AND b.institution_id=p_id AND s.tenant_id=b.tenant_id AND s.id=b.student_id;
 END IF;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_scoped_institution(
 p_tenant text,p_id text,p_expected timestamptz,p_name text,p_contact text,p_phone text,p_share numeric,p_notes text,p_role text,p_actor text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_institution_actor(p_tenant,p_id,p_role,p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('institution-name:'||p_tenant||':'||p_name,0));
 IF EXISTS (SELECT 1 FROM business.institutions i WHERE i.tenant_id=p_tenant AND i.name=p_name AND i.id<>p_id AND i.legacy_deleted=false) THEN
  RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_NAME_EXISTS' USING ERRCODE='23505';
 END IF;
 RETURN QUERY UPDATE business.institutions i SET name=p_name,contact_person_legacy=p_contact,contact_phone_legacy=p_phone,revenue_share=p_share,notes=p_notes,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',i.updated_at)+interval '1 millisecond')
  WHERE i.tenant_id=p_tenant AND i.id=p_id AND i.legacy_deleted=false AND i.updated_at=p_expected RETURNING i.id,i.updated_at;
END;
$$;

-- Original InstitutionManager/browserDatabase delete removes the institution only.
-- Retained students, courses, lessons and billing history must not be removed or rewritten.
CREATE OR REPLACE FUNCTION business.vnext_soft_delete_institution(p_tenant_id text,p_institution_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_INSTITUTION_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE business.institutions i SET legacy_deleted=true,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',i.updated_at)+interval '1 millisecond')
  WHERE i.tenant_id=p_tenant_id AND i.id=p_institution_id AND i.legacy_deleted=false AND i.updated_at=p_expected_updated_at RETURNING i.id,i.updated_at;
END;
$$;
CREATE OR REPLACE FUNCTION business.vnext_delete_scoped_institution(p_tenant text,p_id text,p_expected timestamptz,p_role text,p_actor text)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_institution_actor(p_tenant,p_id,p_role,p_actor);
 RETURN QUERY SELECT * FROM business.vnext_soft_delete_institution(p_tenant,p_id,p_expected);
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_check_institution_actor(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_institution(text,text,text,text,text,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_institution(text,text,timestamptz,text,text,text,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_scoped_institution(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_institution(text,text,text,text,text,numeric,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_institution(text,text,timestamptz,text,text,text,numeric,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_institution(text,text,timestamptz,text,text) TO vnext_pg17_writer;
COMMIT;
