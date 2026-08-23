BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_create_room_v1(
  p_tenant_id text,p_room_id text,p_name text,p_address text
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.rooms WHERE tenant_id=p_tenant_id AND name=p_name AND legacy_deleted=false) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_NAME_EXISTS' USING ERRCODE = '23505';
  END IF;
  INSERT INTO business.rooms(id,tenant_id,name,address_legacy,legacy_count,legacy_deleted,created_at,updated_at)
  VALUES (p_room_id,p_tenant_id,p_name,p_address,1,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
  RETURNING business.rooms.id,business.rooms.updated_at INTO id,updated_at;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_room_v1(
  p_tenant_id text,p_room_id text,p_expected_updated_at timestamptz,p_name text,p_address text
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.rooms WHERE tenant_id=p_tenant_id AND name=p_name AND id<>p_room_id AND legacy_deleted=false) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_NAME_EXISTS' USING ERRCODE = '23505';
  END IF;
  UPDATE business.rooms SET name=p_name,address_legacy=p_address,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE tenant_id=p_tenant_id AND id=p_room_id AND legacy_deleted=false AND updated_at=p_expected_updated_at
  RETURNING business.rooms.id,business.rooms.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_soft_delete_room(
  p_tenant_id text,p_room_id text,p_expected_updated_at timestamptz
) RETURNS TABLE(id text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF session_user <> 'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_WRITER_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.courses WHERE tenant_id=p_tenant_id AND legacy_room_id=p_room_id AND legacy_deleted=false) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_REFERENCED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE business.rooms SET legacy_deleted=true,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE tenant_id=p_tenant_id AND id=p_room_id AND legacy_deleted=false AND updated_at=p_expected_updated_at
  RETURNING business.rooms.id,business.rooms.updated_at INTO id,updated_at;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_create_room_v1(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_room_v1(text,text,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_soft_delete_room(text,text,timestamptz) FROM PUBLIC;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_room_v1(text,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_room_v1(text,text,timestamptz,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_soft_delete_room(text,text,timestamptz) TO vnext_pg17_writer;

COMMIT;
