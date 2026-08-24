BEGIN;

GRANT SELECT,INSERT,UPDATE,DELETE ON business.student_contact_directory TO vnext_pg17_business_owner;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_update_student_record_v4(
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
  p_student_source text,
  p_contacts jsonb
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  target_updated_at timestamptz;
  current_contact_updated_at timestamptz;
  contact record;
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_WRITER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_contacts) <> 'array' OR jsonb_array_length(p_contacts) > 3 THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_CONTACTS_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_contacts) AS c(slot smallint, relationship text, phone text, wechat text, expected_updated_at timestamptz)
    WHERE c.slot NOT BETWEEN 1 AND 3
      OR c.relationship NOT IN ('student','guardian')
      OR (c.slot=1 AND c.relationship <> 'student')
      OR (c.slot>1 AND c.relationship <> 'guardian')
      OR (c.phone IS NULL AND c.wechat IS NULL AND c.expected_updated_at IS NULL)
  ) OR (SELECT count(*) <> count(DISTINCT c.slot)
        FROM jsonb_to_recordset(p_contacts) AS c(slot smallint, relationship text, phone text, wechat text, expected_updated_at timestamptz)) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_CONTACTS_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT s.updated_at INTO target_updated_at
  FROM business.students AS s
  WHERE s.tenant_id=p_tenant_id AND s.id=p_student_id AND s.legacy_deleted=false
  FOR UPDATE;
  IF NOT FOUND OR target_updated_at <> p_expected_updated_at THEN
    RETURN;
  END IF;

  FOR contact IN
    SELECT * FROM jsonb_to_recordset(p_contacts) AS c(slot smallint, relationship text, phone text, wechat text, expected_updated_at timestamptz)
  LOOP
    SELECT d.updated_at INTO current_contact_updated_at
    FROM business.student_contact_directory AS d
    WHERE d.student_id=p_student_id AND d.contact_slot=contact.slot
    FOR UPDATE;
    IF contact.expected_updated_at IS NULL THEN
      IF FOUND THEN RETURN; END IF;
    ELSIF NOT FOUND OR current_contact_updated_at <> contact.expected_updated_at THEN
      RETURN;
    END IF;
  END LOOP;

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
   WHERE s.tenant_id=p_tenant_id AND s.id=p_student_id
  RETURNING s.id,s.updated_at INTO id,updated_at;

  FOR contact IN
    SELECT * FROM jsonb_to_recordset(p_contacts) AS c(slot smallint, relationship text, phone text, wechat text, expected_updated_at timestamptz)
  LOOP
    IF contact.phone IS NULL AND contact.wechat IS NULL THEN
      DELETE FROM business.student_contact_directory
       WHERE student_id=p_student_id AND contact_slot=contact.slot;
    ELSE
      INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,phone_value,phone_hmac,wechat_handle,status,updated_at)
      VALUES ('student-contact-' || p_student_id || '-' || contact.slot::text,p_student_id,contact.slot,contact.relationship,contact.phone,NULL,contact.wechat,'active',date_trunc('milliseconds', transaction_timestamp()))
      ON CONFLICT (student_id,contact_slot) DO UPDATE
        SET relationship=EXCLUDED.relationship,
            phone_value=EXCLUDED.phone_value,
            phone_hmac=NULL,
            wechat_handle=EXCLUDED.wechat_handle,
            status='active',
            revoked_at=NULL,
            updated_at=EXCLUDED.updated_at;
    END IF;
  END LOOP;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_update_student_record_v4(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_student_record_v4(text,text,timestamptz,text,text,integer,text,text,text,text,integer,text,jsonb) TO vnext_pg17_writer;

COMMIT;
