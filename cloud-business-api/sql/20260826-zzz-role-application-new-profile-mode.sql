BEGIN;

ALTER TABLE business.cloud_role_applications
  DROP CONSTRAINT IF EXISTS cloud_role_applications_profile_mode_check;
ALTER TABLE business.cloud_role_applications
  ADD CONSTRAINT cloud_role_applications_profile_mode_check
  CHECK (profile_mode IN ('existing','new'));

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
    OR p_requested_identity NOT IN ('teacher','student','family_member') OR p_profile_mode NOT IN ('existing','new')
    OR (p_requested_identity='family_member' AND p_profile_mode <> 'existing')
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

COMMIT;
