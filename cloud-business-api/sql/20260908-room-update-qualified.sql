-- UTF-8: keep room name/address rules and qualify columns against output variables.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_update_room_v1(
  p_tenant_id text,p_room_id text,p_expected_updated_at timestamptz,p_name text,p_address text
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.rooms AS r WHERE r.tenant_id=p_tenant_id AND r.name=p_name AND r.id<>p_room_id AND r.legacy_deleted=false) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_NAME_EXISTS' USING ERRCODE = '23505';
  END IF;
  UPDATE business.rooms AS r SET name=p_name,address_legacy=p_address,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE r.tenant_id=p_tenant_id AND r.id=p_room_id AND r.legacy_deleted=false AND r.updated_at=p_expected_updated_at
  RETURNING r.id,r.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_update_room_v1(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_update_room_v1(text,text,timestamptz,text,text) TO vnext_pg17_writer;
COMMIT;
