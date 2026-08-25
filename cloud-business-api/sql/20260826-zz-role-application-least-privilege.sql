BEGIN;

-- Role applications are identity-bound workflow records. The generic business
-- command credential must neither alter them nor invoke the review capability.
REVOKE ALL ON TABLE business.cloud_role_applications FROM vnext_pg17_writer;
REVOKE ALL ON TABLE business.cloud_role_applications FROM vnext_pg17_identity_verifier;
REVOKE EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v1(text,text,text,text,text,timestamptz) FROM vnext_pg17_writer;

CREATE OR REPLACE FUNCTION business.vnext_read_latest_cloud_role_application_v2(
  p_tenant_id text,p_account_id text
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,status text,submitted_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_account_id IS NULL OR btrim(p_account_id)='' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.status,a.submitted_at
      FROM business.cloud_role_applications AS a
     WHERE a.tenant_id=p_tenant_id AND a.cloud_account_id=p_account_id
     ORDER BY a.submitted_at DESC,a.application_id DESC LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_submit_cloud_role_application_v2(
  p_tenant_id text,p_account_id text,p_application_id text,p_idempotency_key text,p_requested_identity text,
  p_profile_mode text,p_binding_hint text,p_submitted_at timestamptz
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,status text,submitted_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_account_id IS NULL OR btrim(p_account_id)=''
    OR p_application_id IS NULL OR btrim(p_application_id)='' OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)=''
    OR p_requested_identity NOT IN ('teacher','student','family_member') OR p_profile_mode <> 'existing'
    OR p_binding_hint IS NULL OR btrim(p_binding_hint)='' OR p_submitted_at IS NULL THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    INSERT INTO business.cloud_role_applications
      (tenant_id,cloud_account_id,application_id,idempotency_key,requested_identity,profile_mode,binding_hint,status,submitted_at,updated_at)
    VALUES (p_tenant_id,p_account_id,p_application_id,p_idempotency_key,p_requested_identity,p_profile_mode,p_binding_hint,'submitted',p_submitted_at,p_submitted_at)
    ON CONFLICT (tenant_id,cloud_account_id,idempotency_key) DO UPDATE
      SET updated_at=business.cloud_role_applications.updated_at
    RETURNING cloud_role_applications.application_id,cloud_role_applications.requested_identity,cloud_role_applications.profile_mode,
      cloud_role_applications.binding_hint,cloud_role_applications.status,cloud_role_applications.submitted_at;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_list_submitted_cloud_role_applications_v2(
  p_tenant_id text
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,status text,submitted_at timestamptz,
  reviewed_at timestamptz,reviewed_by_account_id text,profile_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT a.application_id,a.requested_identity,a.profile_mode,a.binding_hint,a.status,a.submitted_at,
      a.reviewed_at,a.reviewed_by_account_id,a.profile_id
      FROM business.cloud_role_applications AS a
     WHERE a.tenant_id=p_tenant_id AND a.status='submitted'
     ORDER BY a.submitted_at ASC,a.application_id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_review_cloud_role_application_v2(
  p_tenant_id text,p_reviewer_account_id text,p_application_id text,p_decision text,p_profile_id text,p_reviewed_at timestamptz
) RETURNS TABLE(
  application_id text,requested_identity text,profile_mode text,binding_hint text,status text,submitted_at timestamptz,
  reviewed_at timestamptz,reviewed_by_account_id text,profile_id text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE application_row business.cloud_role_applications%ROWTYPE;
DECLARE grant_role text;
DECLARE grant_profile_type text;
DECLARE grant_relationship text;
BEGIN
  IF session_user <> 'vnext_pg17_identity_verifier' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_reviewer_account_id IS NULL OR btrim(p_reviewer_account_id)=''
    OR p_application_id IS NULL OR btrim(p_application_id)='' OR p_decision NOT IN ('approved','rejected')
    OR p_reviewed_at IS NULL OR (p_decision='approved' AND (p_profile_id IS NULL OR btrim(p_profile_id)=''))
    OR (p_decision='rejected' AND p_profile_id IS NOT NULL) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business.miniapp_cloud_role_grants AS role_grant
     WHERE role_grant.account_id=p_reviewer_account_id AND role_grant.role='super_admin' AND role_grant.status='active'
  ) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_REVIEWER_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT role_application.* INTO application_row FROM business.cloud_role_applications AS role_application
   WHERE role_application.tenant_id=p_tenant_id AND role_application.application_id=p_application_id FOR UPDATE;
  IF NOT FOUND OR application_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_NOT_REVIEWABLE' USING ERRCODE = 'P0001';
  END IF;
  IF p_decision='approved' THEN
    grant_role := CASE WHEN application_row.requested_identity='teacher' THEN 'teacher' ELSE 'student' END;
    grant_profile_type := grant_role;
    grant_relationship := CASE
      WHEN application_row.requested_identity='family_member' THEN 'guardian'
      WHEN application_row.requested_identity='student' THEN 'student'
      ELSE NULL
    END;
    INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship)
    VALUES (application_row.cloud_account_id,grant_role,'active',grant_profile_type,p_profile_id,grant_relationship)
    ON CONFLICT (account_id,role) DO UPDATE SET
      status='active',profile_type=EXCLUDED.profile_type,profile_id=EXCLUDED.profile_id,
      student_relationship=EXCLUDED.student_relationship,updated_at=transaction_timestamp();
  END IF;
  RETURN QUERY
    UPDATE business.cloud_role_applications AS application_update
       SET status=p_decision,reviewed_at=p_reviewed_at,reviewed_by_account_id=p_reviewer_account_id,
           profile_id=p_profile_id,updated_at=transaction_timestamp()
     WHERE application_update.tenant_id=p_tenant_id AND application_update.application_id=p_application_id
     RETURNING application_update.application_id,application_update.requested_identity,application_update.profile_mode,
       application_update.binding_hint,application_update.status,application_update.submitted_at,application_update.reviewed_at,
       application_update.reviewed_by_account_id,application_update.profile_id;
END;
$$;

GRANT USAGE ON SCHEMA business TO vnext_pg17_identity_verifier;
REVOKE EXECUTE ON FUNCTION business.vnext_read_latest_cloud_role_application_v2(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.vnext_submit_cloud_role_application_v2(text,text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.vnext_list_submitted_cloud_role_applications_v2(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v2(text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_read_latest_cloud_role_application_v2(text,text) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION business.vnext_submit_cloud_role_application_v2(text,text,text,text,text,text,text,timestamptz) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION business.vnext_list_submitted_cloud_role_applications_v2(text) TO vnext_pg17_identity_verifier;
GRANT EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v2(text,text,text,text,text,timestamptz) TO vnext_pg17_identity_verifier;

COMMIT;
