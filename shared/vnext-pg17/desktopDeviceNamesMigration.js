'use strict';
// UTF-8: additive presentation metadata; no trust, role, or session-version changes.
module.exports = String.raw`ALTER TABLE vnext_control_plane.vnext_trusted_devices
  ADD COLUMN display_name text COLLATE "C"
  CONSTRAINT vnext_trusted_devices_display_name_check CHECK (
    display_name IS NULL OR (char_length(display_name) BETWEEN 1 AND 128
      AND display_name=btrim(display_name) AND display_name !~ '[[:cntrl:]]'
      AND display_name !~ U&'[\202A-\202E\2066-\2069]')
  );
CREATE FUNCTION vnext_control_plane.vnext_register_named_desktop_online(
  p_assertion_id text, p_idempotency_key text, p_receipt_id text, p_audit_event_id text,
  p_outbox_event_id text, p_session_id text, p_link_id text, p_session_expires_at timestamptz,
  p_canonical_result_json text, p_result_sha256 text, p_canonical_payload_json text,
  p_payload_sha256 text, p_named_request_json text
) RETURNS TABLE(receipt_id text, session_id text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a vnext_control_plane.vnext_online_identity_assertions%ROWTYPE; named json; registered record; name_value text;
BEGIN
  IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_named_request_json IS NULL OR NOT (p_named_request_json IS JSON OBJECT WITH UNIQUE KEYS)
    THEN RAISE EXCEPTION 'VNEXT_DESKTOP_NAME_REQUEST_INVALID' USING ERRCODE='P0001'; END IF;
  named := p_named_request_json::json;
  name_value := named->>'deviceName';
  IF (SELECT count(*) FROM json_object_keys(named))<>7
    OR json_typeof(named->'deviceName') IS DISTINCT FROM 'string'
    OR name_value IS NULL OR name_value<>btrim(name_value) OR char_length(name_value) NOT BETWEEN 1 AND 128
    OR name_value ~ '[[:cntrl:]]' OR name_value ~ U&'[\202A-\202E\2066-\2069]'
    THEN RAISE EXCEPTION 'VNEXT_DESKTOP_NAME_REQUEST_INVALID' USING ERRCODE='P0001'; END IF;
  SELECT * INTO a FROM vnext_control_plane.vnext_online_identity_assertions WHERE assertion_id=p_assertion_id FOR UPDATE;
  IF NOT FOUND OR a.canonical_request_sha256<>encode(sha256(convert_to(p_named_request_json,'UTF8')),'hex')
    OR named->>'authorityId' IS DISTINCT FROM a.authority_id
    OR named->>'accountId' IS DISTINCT FROM a.account_id
    OR named->>'deviceId' IS DISTINCT FROM a.device_id
    OR named->>'installationId' IS DISTINCT FROM a.installation_id
    OR named->>'keyFingerprint' IS DISTINCT FROM a.key_fingerprint
    OR named->>'idempotencyKey' IS DISTINCT FROM p_idempotency_key
    THEN RAISE EXCEPTION 'VNEXT_DESKTOP_NAME_ASSERTION_MISMATCH' USING ERRCODE='P0001'; END IF;
  SELECT * INTO STRICT registered FROM vnext_control_plane.vnext_register_unified_desktop_online(
    p_assertion_id,p_idempotency_key,p_receipt_id,p_audit_event_id,p_outbox_event_id,
    p_session_id,p_link_id,p_session_expires_at,p_canonical_result_json,p_result_sha256,
    p_canonical_payload_json,p_payload_sha256);
  IF NOT registered.replayed THEN
    UPDATE vnext_control_plane.vnext_trusted_devices SET display_name=name_value
      WHERE authority_id=a.authority_id AND device_id=a.device_id;
  END IF;
  RETURN QUERY SELECT registered.receipt_id,registered.session_id,registered.replayed;
END;
$$;
CREATE FUNCTION vnext_control_plane.vnext_list_named_desktop_account_devices(p_authority_id text,p_account_id text)
RETURNS TABLE("deviceId" text,"installationId" text,status text,"rowVersion" bigint,
  "createdAt" timestamptz,"updatedAt" timestamptz,"lastSeenAt" timestamptz,"revokedAt" timestamptz,"deviceName" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT listed.*,d.display_name
    FROM vnext_control_plane.vnext_list_desktop_account_devices(p_authority_id,p_account_id) listed
    JOIN vnext_control_plane.vnext_trusted_devices d ON d.authority_id=p_authority_id AND d.device_id=listed."deviceId"
    ORDER BY listed."updatedAt" DESC,listed."deviceId";
END;
$$;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_register_named_desktop_online(text,text,text,text,text,text,text,timestamptz,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vnext_control_plane.vnext_list_named_desktop_account_devices(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_register_named_desktop_online(text,text,text,text,text,text,text,timestamptz,text,text,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION vnext_control_plane.vnext_list_named_desktop_account_devices(text,text) TO vnext_pg17_writer;`;
