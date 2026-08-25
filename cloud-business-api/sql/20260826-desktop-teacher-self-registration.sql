BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_self_register_teacher_v1(
  p_tenant_id text,p_account_id text,p_phone_hmac char(64),p_teacher_id text,p_name text,p_subject text
) RETURNS TABLE(teacher_id text,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN
    RAISE EXCEPTION 'VNEXT_DESKTOP_TEACHER_WRITER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_account_id IS NULL OR btrim(p_account_id)=''
    OR p_phone_hmac IS NULL OR p_phone_hmac !~ '^[0-9a-f]{64}$'
    OR p_teacher_id IS NULL OR btrim(p_teacher_id)='' OR p_name IS NULL OR btrim(p_name)=''
    OR (p_subject IS NOT NULL AND btrim(p_subject)='') THEN
    RAISE EXCEPTION 'VNEXT_DESKTOP_TEACHER_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO business.miniapp_cloud_accounts(account_id,phone_hmac,status)
  VALUES (p_account_id,p_phone_hmac,'active')
  ON CONFLICT (phone_hmac) DO UPDATE
    SET status='active',updated_at=transaction_timestamp()
    WHERE business.miniapp_cloud_accounts.account_id=EXCLUDED.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VNEXT_DESKTOP_TEACHER_ACCOUNT_CONFLICT' USING ERRCODE = '23505';
  END IF;

  INSERT INTO business.teachers(id,tenant_id,name,phone_legacy,subject,hourly_rate,notes,legacy_deleted,created_at,updated_at)
  VALUES (p_teacher_id,p_tenant_id,p_name,NULL,p_subject,0,'',false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  ON CONFLICT (id) DO UPDATE SET
    name=EXCLUDED.name,subject=EXCLUDED.subject,legacy_deleted=false,
    updated_at=date_trunc('milliseconds',transaction_timestamp());

  INSERT INTO business.miniapp_cloud_role_grants(account_id,role,status,profile_type,profile_id,student_relationship)
  VALUES (p_account_id,'teacher','active','teacher',p_teacher_id,NULL)
  ON CONFLICT (account_id,role) DO UPDATE SET
    status='active',profile_type='teacher',profile_id=EXCLUDED.profile_id,
    student_relationship=NULL,updated_at=transaction_timestamp();

  SELECT t.id,t.updated_at INTO teacher_id,updated_at
  FROM business.teachers t WHERE t.tenant_id=p_tenant_id AND t.id=p_teacher_id AND t.legacy_deleted=false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VNEXT_DESKTOP_TEACHER_WRITE_FAILED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION business.vnext_self_register_teacher_v1(text,text,char(64),text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_self_register_teacher_v1(text,text,char(64),text,text,text) TO vnext_pg17_writer;

COMMIT;
