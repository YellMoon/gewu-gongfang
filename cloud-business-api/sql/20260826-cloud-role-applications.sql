BEGIN;

CREATE TABLE IF NOT EXISTS business.cloud_role_applications (
  tenant_id text NOT NULL,
  cloud_account_id text NOT NULL,
  application_id text NOT NULL,
  idempotency_key text NOT NULL,
  requested_identity text NOT NULL CHECK (requested_identity IN ('teacher','student','family_member')),
  profile_mode text NOT NULL CHECK (profile_mode='existing'),
  binding_hint text NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted','approved','rejected')),
  submitted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  reviewed_at timestamptz NULL,
  reviewed_by_account_id text NULL,
  review_note text NULL,
  profile_id text NULL,
  PRIMARY KEY (tenant_id, application_id),
  UNIQUE (tenant_id, cloud_account_id, idempotency_key),
  CHECK (length(binding_hint) > 0)
);

ALTER TABLE business.cloud_role_applications
  ADD COLUMN IF NOT EXISTS profile_id text NULL;

CREATE INDEX IF NOT EXISTS cloud_role_applications_latest_idx
  ON business.cloud_role_applications (tenant_id, cloud_account_id, submitted_at DESC, application_id DESC);

REVOKE ALL ON TABLE business.cloud_role_applications FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON TABLE business.cloud_role_applications TO vnext_pg17_writer;

CREATE OR REPLACE FUNCTION business.vnext_review_cloud_role_application_v1(
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
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_WRITER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_reviewer_account_id IS NULL OR btrim(p_reviewer_account_id)=''
    OR p_application_id IS NULL OR btrim(p_application_id)='' OR p_decision NOT IN ('approved','rejected')
    OR p_reviewed_at IS NULL OR (p_decision='approved' AND (p_profile_id IS NULL OR btrim(p_profile_id)=''))
    OR (p_decision='rejected' AND p_profile_id IS NOT NULL) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business.miniapp_cloud_role_grants
     WHERE account_id=p_reviewer_account_id AND role='super_admin' AND status='active'
  ) THEN
    RAISE EXCEPTION 'VNEXT_ROLE_APPLICATION_REVIEWER_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO application_row FROM business.cloud_role_applications
   WHERE tenant_id=p_tenant_id AND application_id=p_application_id FOR UPDATE;
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
  UPDATE business.cloud_role_applications AS application_update
     SET status=p_decision,reviewed_at=p_reviewed_at,reviewed_by_account_id=p_reviewer_account_id,
         profile_id=p_profile_id,updated_at=transaction_timestamp()
   WHERE tenant_id=p_tenant_id AND application_id=p_application_id
   RETURNING application_update.application_id,application_update.requested_identity,application_update.profile_mode,application_update.binding_hint,application_update.status,application_update.submitted_at,application_update.reviewed_at,application_update.reviewed_by_account_id,application_update.profile_id
   INTO application_id,requested_identity,profile_mode,binding_hint,status,submitted_at,reviewed_at,reviewed_by_account_id,profile_id;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v1(text,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v1(text,text,text,text,text,timestamptz) TO vnext_pg17_writer;

COMMIT;
