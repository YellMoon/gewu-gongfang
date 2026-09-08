BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

-- UTF-8: source=2 identifies an ordinary institution pupil, not a synthetic
-- institution billing record. Preserve the public contract and existing ACLs.
-- No historical rows are reclassified by this migration.
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
  VALUES (p_student_id,p_tenant_id,p_name,p_school,p_grade_year,p_grade_current,p_institution_id,p_parent_name,p_notes,p_legacy_source_type,p_student_source,false,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.students.id,business.students.updated_at INTO id,updated_at;
  FOR contact IN SELECT * FROM jsonb_to_recordset(p_contacts) AS c(slot smallint, relationship text, phone text, wechat text)
  LOOP
    INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,phone_value,phone_hmac,wechat_handle,status)
    VALUES ('student-contact-' || p_student_id || '-' || contact.slot::text,p_student_id,contact.slot,contact.relationship,contact.phone,NULL,contact.wechat,'active');
  END LOOP;
  RETURN NEXT;
END;
$$;

COMMIT;
