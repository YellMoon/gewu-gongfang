BEGIN;

GRANT SELECT,INSERT,UPDATE ON business.student_contact_directory TO vnext_pg17_business_owner;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_create_student_record_v1(
  p_tenant_id text,
  p_student_id text,
  p_name text,
  p_school text,
  p_grade_year integer,
  p_grade_current text,
  p_institution_id text,
  p_parent_name text,
  p_notes text,
  p_legacy_source_type integer,
  p_student_source text,
  p_unused_reserved text,
  p_contacts jsonb
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE contact record;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_contacts) <> 'array' OR jsonb_array_length(p_contacts) > 3 THEN RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_CONTACTS_INVALID' USING ERRCODE = '22023'; END IF;
  INSERT INTO business.students(id,tenant_id,name,school_legacy,grade_year,grade_current,institution_id,parent_name_legacy,notes,legacy_source_type,student_source_legacy,legacy_is_institution_student,legacy_deleted,created_at,updated_at)
  VALUES (p_student_id,p_tenant_id,p_name,p_school,p_grade_year,p_grade_current,p_institution_id,p_parent_name,p_notes,p_legacy_source_type,p_student_source,COALESCE(p_legacy_source_type=2,false),false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.students.id,business.students.updated_at INTO id,updated_at;
  FOR contact IN SELECT * FROM jsonb_to_recordset(p_contacts) AS c(slot smallint, relationship text, phone text, wechat text)
  LOOP
    INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,phone_value,phone_hmac,wechat_handle,status)
    VALUES ('student-contact-' || p_student_id || '-' || contact.slot::text,p_student_id,contact.slot,contact.relationship,contact.phone,NULL,contact.wechat,'active');
  END LOOP;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_student(
  p_tenant_id text,p_student_id text,p_expected_updated_at timestamptz
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.course_student_pricings WHERE tenant_id=p_tenant_id AND student_id=p_student_id)
    OR EXISTS (SELECT 1 FROM business.schedule_student_overrides WHERE tenant_id=p_tenant_id AND student_id=p_student_id) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_REFERENCED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE business.students SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
  WHERE tenant_id=p_tenant_id AND id=p_student_id AND legacy_deleted=false AND updated_at=p_expected_updated_at
  RETURNING business.students.id,business.students.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_create_student_record_v1(text,text,text,text,integer,text,text,text,text,integer,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_student(text,text,timestamptz) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_student_record_v1(text,text,text,text,integer,text,text,text,text,integer,text,text,jsonb) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_student(text,text,timestamptz) TO vnext_pg17_writer;

COMMIT;
