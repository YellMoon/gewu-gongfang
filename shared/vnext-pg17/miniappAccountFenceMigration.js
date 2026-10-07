'use strict';
// Additive M30: miniapp tickets are fenced by the canonical control plane.
module.exports = `CREATE FUNCTION vnext_control_plane.vnext_read_miniapp_account_fence(p_authority_id text,p_account_id text)
RETURNS TABLE(authority_id text,account_id text,authority_updated_at text,auth_version bigint,access_version bigint,revocation_version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user<>'vnext_pg17_identity_verifier' THEN RAISE EXCEPTION 'VNEXT_IDENTITY_VERIFIER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_authority_id IS NULL OR p_account_id IS NULL OR p_authority_id<>btrim(p_authority_id) OR p_account_id<>btrim(p_account_id)
    OR p_authority_id='' OR p_account_id='' THEN RAISE EXCEPTION 'VNEXT_MINIAPP_ACCOUNT_FENCE_INVALID' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT a.authority_id,a.account_id,to_char(au.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),a.auth_version,a.access_version,a.revocation_version
    FROM vnext_control_plane.vnext_accounts a
    JOIN vnext_control_plane.vnext_authorities au ON au.authority_id=a.authority_id
    WHERE a.authority_id=p_authority_id AND a.account_id=p_account_id AND a.status='active' AND au.status='active';
END;
$$;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_read_miniapp_account_fence(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_read_miniapp_account_fence(text,text) TO vnext_pg17_identity_verifier;`;
