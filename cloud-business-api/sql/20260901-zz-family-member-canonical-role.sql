BEGIN;

ALTER TABLE business.miniapp_cloud_role_grants
  DROP CONSTRAINT IF EXISTS miniapp_cloud_role_grants_role_check,
  DROP CONSTRAINT IF EXISTS miniapp_cloud_role_grants_profile_check,
  DROP CONSTRAINT IF EXISTS miniapp_cloud_role_grants_student_relationship_check;

UPDATE business.miniapp_cloud_role_grants
  SET role='family_member'
  WHERE role='student' AND student_relationship='guardian';

ALTER TABLE business.miniapp_cloud_role_grants
  ADD CONSTRAINT miniapp_cloud_role_grants_role_check CHECK (
    role IN ('super_admin','teacher','student','family_member')
  ),
  ADD CONSTRAINT miniapp_cloud_role_grants_profile_check CHECK (
    (role='teacher' AND profile_type='teacher' AND profile_id IS NOT NULL AND profile_id=btrim(profile_id) AND profile_id<>'')
    OR (role='student' AND profile_type='student' AND profile_id IS NOT NULL AND profile_id=btrim(profile_id) AND profile_id<>'')
    OR (role='family_member' AND profile_type='student' AND profile_id IS NOT NULL AND profile_id=btrim(profile_id) AND profile_id<>'')
    OR (role='super_admin' AND profile_type IS NULL AND profile_id IS NULL)
  ),
  ADD CONSTRAINT miniapp_cloud_role_grants_student_relationship_check CHECK (
    (role='student' AND student_relationship='student')
    OR (role='family_member' AND student_relationship='guardian')
    OR (role IN ('teacher','super_admin') AND student_relationship IS NULL)
  );

CREATE OR REPLACE FUNCTION business.miniapp_cloud_role_grant_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.role='teacher' AND NOT EXISTS (
    SELECT 1 FROM business.teachers
     WHERE id=NEW.profile_id AND legacy_deleted=false
  ) THEN
    RAISE EXCEPTION 'CLOUD_MINIAPP_PROFILE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF NEW.role IN ('student','family_member') AND NOT EXISTS (
    SELECT 1 FROM business.students
     WHERE id=NEW.profile_id AND legacy_deleted=false
  ) THEN
    RAISE EXCEPTION 'CLOUD_MINIAPP_PROFILE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION business.miniapp_cloud_student_access_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.role NOT IN ('student','family_member') OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('miniapp-student-access:' || NEW.profile_id, 19));

  IF NEW.role='student' AND EXISTS (
    SELECT 1
      FROM business.miniapp_cloud_role_grants AS existing
     WHERE existing.role='student'
       AND existing.status='active'
       AND existing.profile_id=NEW.profile_id
       AND existing.account_id<>NEW.account_id
  ) THEN
    RAISE EXCEPTION 'VNEXT_STUDENT_ACCESS_SELF_CONFLICT' USING ERRCODE='P0001';
  END IF;

  IF NEW.role='family_member' AND (
    SELECT count(*)
      FROM business.miniapp_cloud_role_grants AS existing
     WHERE existing.role='family_member'
       AND existing.status='active'
       AND existing.profile_id=NEW.profile_id
       AND existing.account_id<>NEW.account_id
  ) >= 2 THEN
    RAISE EXCEPTION 'VNEXT_STUDENT_ACCESS_GUARDIAN_LIMIT' USING ERRCODE='P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_review_cloud_role_application_v4(
  p_tenant_id text,p_reviewer_account_id text,p_application_id text,p_decision text,p_profile_id text,p_reviewed_at timestamptz
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,profile_name text,profile_phone text,
  status text,submitted_at timestamptz,reviewed_at timestamptz,reviewed_by_account_id text,profile_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE application_row business.cloud_role_applications%ROWTYPE;
DECLARE target_profile_id text;
DECLARE grant_role text;
DECLARE grant_profile_type text;
DECLARE grant_relationship text;
DECLARE expected_relationship text;
DECLARE candidate_count bigint;
DECLARE operation_at timestamptz := date_trunc('milliseconds',transaction_timestamp());
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_reviewer_account_id IS NULL OR btrim(p_reviewer_account_id)=''
    OR p_application_id IS NULL OR btrim(p_application_id)='' OR p_decision NOT IN ('approved','rejected')
    OR p_reviewed_at IS NULL OR (p_profile_id IS NOT NULL AND (btrim(p_profile_id)='' OR char_length(p_profile_id)>128))
    OR (p_decision='rejected' AND p_profile_id IS NOT NULL) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business.miniapp_cloud_role_grants AS role_grant
     WHERE role_grant.account_id=p_reviewer_account_id AND role_grant.role='super_admin' AND role_grant.status='active'
  ) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_REVIEWER_DENIED' USING ERRCODE='42501';
  END IF;

  SELECT a.* INTO application_row FROM business.cloud_role_applications AS a
   WHERE a.tenant_id=p_tenant_id AND a.application_id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_NOT_REVIEWABLE' USING ERRCODE='P0001';
  END IF;
  IF application_row.status<>'submitted' THEN
    IF application_row.status=p_decision
      AND (p_decision='rejected' OR p_profile_id IS NULL OR p_profile_id=application_row.profile_id) THEN
      RETURN QUERY SELECT a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.profile_name,a.profile_phone,a.status,a.submitted_at,
        a.reviewed_at,a.reviewed_by_account_id,a.profile_id
        FROM business.cloud_role_applications AS a
       WHERE a.tenant_id=p_tenant_id AND a.application_id=p_application_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_NOT_REVIEWABLE' USING ERRCODE='P0001';
  END IF;
  IF application_row.requested_identity='family_member' AND application_row.profile_mode <> 'existing' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF application_row.profile_name IS NULL OR application_row.profile_phone IS NULL OR application_row.profile_phone_hmac IS NULL THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_DETAILS_REQUIRED' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business.miniapp_cloud_accounts AS account
     WHERE account.account_id=application_row.cloud_account_id AND account.status='active'
       AND account.phone_hmac=application_row.profile_phone_hmac
  ) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED' USING ERRCODE='P0001';
  END IF;

  IF p_decision='rejected' THEN
    RETURN QUERY
      UPDATE business.cloud_role_applications AS a
         SET status='rejected',reviewed_at=p_reviewed_at,reviewed_by_account_id=p_reviewer_account_id,
             profile_id=NULL,updated_at=operation_at
       WHERE a.tenant_id=p_tenant_id AND a.application_id=p_application_id
       RETURNING a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.profile_name,a.profile_phone,a.status,a.submitted_at,
         a.reviewed_at,a.reviewed_by_account_id,a.profile_id;
    RETURN;
  END IF;

  grant_role := application_row.requested_identity;
  grant_profile_type := CASE WHEN grant_role='family_member' THEN 'student' ELSE grant_role END;
  grant_relationship := CASE WHEN grant_role='family_member' THEN 'guardian'
    WHEN grant_role='student' THEN 'student' ELSE NULL END;

  IF application_row.profile_mode='new' THEN
    IF p_profile_id IS NOT NULL OR application_row.requested_identity='family_member' THEN
      RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE='22023';
    END IF;
    target_profile_id := application_row.requested_profile_id;
    IF target_profile_id IS NULL OR btrim(target_profile_id)='' THEN
      RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_DETAILS_REQUIRED' USING ERRCODE='P0001';
    END IF;
    IF application_row.requested_identity='teacher' THEN
      IF EXISTS (SELECT 1 FROM business.teachers AS teacher WHERE teacher.id=target_profile_id) THEN
        RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_ID_CONFLICT' USING ERRCODE='P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM business.teachers AS teacher WHERE teacher.tenant_id=p_tenant_id AND teacher.legacy_deleted=false
        AND lower(btrim(teacher.name))=lower(application_row.profile_name)) THEN
        RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_NAME_CONFLICT' USING ERRCODE='P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM business.teachers AS teacher WHERE teacher.tenant_id=p_tenant_id AND teacher.legacy_deleted=false
        AND regexp_replace(COALESCE(teacher.phone_legacy,''),'[^0-9]','','g')=application_row.profile_phone) THEN
        RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_PHONE_CONFLICT' USING ERRCODE='P0001';
      END IF;
      INSERT INTO business.teachers(id,tenant_id,name,phone_legacy,subject,hourly_rate,notes,legacy_deleted,created_at,updated_at)
      VALUES (target_profile_id,p_tenant_id,application_row.profile_name,application_row.profile_phone,NULL,0,'',false,operation_at,operation_at);
    ELSE
      IF EXISTS (SELECT 1 FROM business.students AS student WHERE student.id=target_profile_id) THEN
        RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_ID_CONFLICT' USING ERRCODE='P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM business.students AS student WHERE student.tenant_id=p_tenant_id AND student.legacy_deleted=false
        AND lower(btrim(student.name))=lower(application_row.profile_name)) THEN
        RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_NAME_CONFLICT' USING ERRCODE='P0001';
      END IF;
      IF EXISTS (
        SELECT 1 FROM business.students AS student
        LEFT JOIN business.student_contact_directory AS contact ON contact.student_id=student.id AND contact.status='active'
        WHERE student.tenant_id=p_tenant_id AND student.legacy_deleted=false
          AND (regexp_replace(COALESCE(student.phone_legacy,''),'[^0-9]','','g')=application_row.profile_phone
            OR contact.phone_hmac=application_row.profile_phone_hmac OR contact.phone_value=application_row.profile_phone)
      ) THEN
        RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_PHONE_CONFLICT' USING ERRCODE='P0001';
      END IF;
      INSERT INTO business.students(id,tenant_id,name,phone_legacy,legacy_is_institution_student,legacy_deleted,created_at,updated_at)
      VALUES (target_profile_id,p_tenant_id,application_row.profile_name,application_row.profile_phone,false,false,operation_at,operation_at);
      INSERT INTO business.student_contact_directory(contact_id,student_id,contact_slot,relationship,phone_value,phone_hmac,wechat_handle,status,created_at,updated_at)
      VALUES ('role-contact-' || target_profile_id || '-1',target_profile_id,1,'student',application_row.profile_phone,
        application_row.profile_phone_hmac,NULL,'active',operation_at,operation_at);
    END IF;
  ELSE
    IF application_row.requested_identity='teacher' THEN
      SELECT count(*),min(teacher.id) INTO candidate_count,target_profile_id
        FROM business.teachers AS teacher
       WHERE teacher.tenant_id=p_tenant_id AND teacher.legacy_deleted=false
         AND lower(btrim(teacher.name))=lower(application_row.profile_name)
         AND regexp_replace(COALESCE(teacher.phone_legacy,''),'[^0-9]','','g')=application_row.profile_phone
         AND (p_profile_id IS NULL OR teacher.id=p_profile_id);
      IF candidate_count=0 THEN RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_MISMATCH' USING ERRCODE='P0001'; END IF;
      IF candidate_count>1 THEN RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_NAME_CONFLICT' USING ERRCODE='P0001'; END IF;
    ELSE
      expected_relationship := CASE WHEN application_row.requested_identity='family_member' THEN 'guardian' ELSE 'student' END;
      SELECT count(DISTINCT student.id),min(student.id) INTO candidate_count,target_profile_id
        FROM business.students AS student
        JOIN business.student_contact_directory AS contact ON contact.student_id=student.id
       WHERE student.tenant_id=p_tenant_id AND student.legacy_deleted=false
         AND lower(btrim(student.name))=lower(application_row.profile_name)
         AND contact.status='active' AND contact.relationship=expected_relationship
         AND (contact.phone_hmac=application_row.profile_phone_hmac OR contact.phone_value=application_row.profile_phone)
         AND (p_profile_id IS NULL OR student.id=p_profile_id);
      IF candidate_count=0 AND application_row.requested_identity='family_member' THEN
        RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_GUARDIAN_RELATION_REQUIRED' USING ERRCODE='P0001';
      END IF;
      IF candidate_count=0 THEN RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_MISMATCH' USING ERRCODE='P0001'; END IF;
      IF candidate_count>1 THEN RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_PROFILE_NAME_CONFLICT' USING ERRCODE='P0001'; END IF;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM business.miniapp_cloud_role_grants AS role_grant
    WHERE role_grant.account_id=application_row.cloud_account_id AND role_grant.status='active') THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_ACCOUNT_ROLE_CONFLICT' USING ERRCODE='P0001';
  END IF;
  INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship)
  VALUES (application_row.cloud_account_id,grant_role,'active',grant_profile_type,target_profile_id,grant_relationship)
  ON CONFLICT (account_id,role) DO UPDATE SET status='active',profile_type=EXCLUDED.profile_type,profile_id=EXCLUDED.profile_id,
    student_relationship=EXCLUDED.student_relationship,updated_at=operation_at;

  RETURN QUERY
    UPDATE business.cloud_role_applications AS a
       SET status='approved',reviewed_at=p_reviewed_at,reviewed_by_account_id=p_reviewer_account_id,
           profile_id=target_profile_id,updated_at=operation_at
     WHERE a.tenant_id=p_tenant_id AND a.application_id=p_application_id
     RETURNING a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.profile_name,a.profile_phone,a.status,a.submitted_at,
       a.reviewed_at,a.reviewed_by_account_id,a.profile_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v4(text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v4(text,text,text,text,text,timestamptz) TO vnext_pg17_identity_verifier;
DROP FUNCTION business.vnext_review_cloud_role_application_v3(text,text,text,text,text,timestamptz);

COMMIT;
