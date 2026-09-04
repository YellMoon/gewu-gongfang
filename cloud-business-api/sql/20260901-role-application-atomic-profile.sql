BEGIN;

ALTER TABLE business.cloud_role_applications
  ADD COLUMN IF NOT EXISTS profile_name text NULL,
  ADD COLUMN IF NOT EXISTS profile_phone text NULL,
  ADD COLUMN IF NOT EXISTS profile_phone_hmac char(64) NULL,
  ADD COLUMN IF NOT EXISTS requested_profile_id text NULL;

ALTER TABLE business.cloud_role_applications
  ADD CONSTRAINT cloud_role_applications_profile_name_v3_check
    CHECK (profile_name IS NULL OR (profile_name=btrim(profile_name) AND profile_name<>'' AND char_length(profile_name)<=64)),
  ADD CONSTRAINT cloud_role_applications_profile_phone_v3_check
    CHECK (profile_phone IS NULL OR profile_phone ~ '^1[3-9][0-9]{9}$'),
  ADD CONSTRAINT cloud_role_applications_profile_phone_hmac_v3_check
    CHECK (profile_phone_hmac IS NULL OR profile_phone_hmac ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT cloud_role_applications_requested_profile_v3_check
    CHECK ((profile_mode='new' AND requested_profile_id IS NOT NULL AND requested_profile_id=btrim(requested_profile_id) AND requested_profile_id<>'')
      OR (profile_mode='existing' AND requested_profile_id IS NULL)
      OR (profile_name IS NULL AND profile_phone IS NULL AND profile_phone_hmac IS NULL));

CREATE OR REPLACE FUNCTION business.vnext_read_latest_cloud_role_application_v3(
  p_tenant_id text,p_account_id text
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,profile_name text,profile_phone text,
  status text,submitted_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_account_id IS NULL OR btrim(p_account_id)='' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.profile_name,a.profile_phone,a.status,a.submitted_at
      FROM business.cloud_role_applications AS a
     WHERE a.tenant_id=p_tenant_id AND a.cloud_account_id=p_account_id
     ORDER BY a.submitted_at DESC,a.application_id DESC LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_submit_cloud_role_application_v3(
  p_tenant_id text,p_account_id text,p_application_id text,p_idempotency_key text,p_requested_identity text,
  p_profile_mode text,p_profile_name text,p_profile_phone text,p_profile_phone_hmac char(64),p_requested_profile_id text,
  p_submitted_at timestamptz
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,profile_name text,profile_phone text,
  status text,submitted_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE application_row business.cloud_role_applications%ROWTYPE;
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_account_id IS NULL OR btrim(p_account_id)=''
    OR p_application_id IS NULL OR btrim(p_application_id)='' OR char_length(p_application_id)>128
    OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR char_length(p_idempotency_key)>256
    OR p_requested_identity NOT IN ('teacher','student','family_member') OR p_profile_mode NOT IN ('existing','new')
    OR (p_requested_identity='family_member' AND p_profile_mode<>'existing')
    OR p_profile_name IS NULL OR btrim(p_profile_name)='' OR p_profile_name<>btrim(p_profile_name) OR char_length(p_profile_name)>64
    OR p_profile_phone IS NULL OR p_profile_phone !~ '^1[3-9][0-9]{9}$'
    OR p_profile_phone_hmac IS NULL OR p_profile_phone_hmac !~ '^[0-9a-f]{64}$'
    OR (p_profile_mode='new' AND (p_requested_profile_id IS NULL OR btrim(p_requested_profile_id)='' OR char_length(p_requested_profile_id)>128))
    OR (p_profile_mode='existing' AND p_requested_profile_id IS NOT NULL) OR p_submitted_at IS NULL THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business.miniapp_cloud_accounts AS account
     WHERE account.account_id=p_account_id AND account.status='active' AND account.phone_hmac=p_profile_phone_hmac
  ) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED' USING ERRCODE='P0001';
  END IF;

  SELECT a.* INTO application_row
    FROM business.cloud_role_applications AS a
   WHERE a.tenant_id=p_tenant_id AND a.cloud_account_id=p_account_id AND a.idempotency_key=p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF application_row.requested_identity<>p_requested_identity OR application_row.profile_mode<>p_profile_mode
      OR application_row.profile_name<>p_profile_name OR application_row.profile_phone<>p_profile_phone
      OR application_row.profile_phone_hmac<>p_profile_phone_hmac THEN
      RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';
    END IF;
    RETURN QUERY SELECT a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.profile_name,a.profile_phone,a.status,a.submitted_at
      FROM business.cloud_role_applications AS a
     WHERE a.tenant_id=p_tenant_id AND a.application_id=application_row.application_id;
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO business.cloud_role_applications(
      tenant_id,cloud_account_id,application_id,idempotency_key,requested_identity,profile_mode,binding_hint,
      profile_name,profile_phone,profile_phone_hmac,requested_profile_id,status,submitted_at,updated_at
    ) VALUES (
      p_tenant_id,p_account_id,p_application_id,p_idempotency_key,p_requested_identity,p_profile_mode,
      p_profile_name || ' / ' || p_profile_phone,p_profile_name,p_profile_phone,p_profile_phone_hmac,p_requested_profile_id,
      'submitted',p_submitted_at,p_submitted_at
    )
    RETURNING cloud_role_applications.application_id,cloud_role_applications.requested_identity,cloud_role_applications.profile_mode,
      cloud_role_applications.binding_hint,cloud_role_applications.profile_name,cloud_role_applications.profile_phone,
      cloud_role_applications.status,cloud_role_applications.submitted_at;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_list_submitted_cloud_role_applications_v3(
  p_tenant_id text
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,profile_name text,profile_phone text,
  status text,submitted_at timestamptz,reviewed_at timestamptz,reviewed_by_account_id text,profile_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.profile_name,a.profile_phone,a.status,a.submitted_at,
      a.reviewed_at,a.reviewed_by_account_id,a.profile_id
      FROM business.cloud_role_applications AS a
     WHERE a.tenant_id=p_tenant_id AND a.status='submitted'
     ORDER BY a.submitted_at ASC,a.application_id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_review_cloud_role_application_v3(
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

  grant_role := CASE WHEN application_row.requested_identity='teacher' THEN 'teacher' ELSE 'student' END;
  grant_relationship := CASE WHEN application_row.requested_identity='family_member' THEN 'guardian'
    WHEN application_row.requested_identity='student' THEN 'student' ELSE NULL END;

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
  VALUES (application_row.cloud_account_id,grant_role,'active',grant_role,target_profile_id,grant_relationship)
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

REVOKE EXECUTE ON FUNCTION business.vnext_read_latest_cloud_role_application_v3(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.vnext_submit_cloud_role_application_v3(text,text,text,text,text,text,text,text,char(64),text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.vnext_list_submitted_cloud_role_applications_v3(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v3(text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_read_latest_cloud_role_application_v3(text,text) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION business.vnext_submit_cloud_role_application_v3(text,text,text,text,text,text,text,text,char(64),text,timestamptz) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION business.vnext_list_submitted_cloud_role_applications_v3(text) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v3(text,text,text,text,text,timestamptz) TO vnext_pg17_identity_verifier;

COMMIT;
