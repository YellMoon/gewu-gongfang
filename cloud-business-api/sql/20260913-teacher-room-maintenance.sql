-- UTF-8: preserve original resource-only edits/deletion; historical use is not ownership.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

CREATE OR REPLACE FUNCTION business.vnext_check_room_actor(p_tenant text,p_id text,p_role text,p_actor text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE creator text;
BEGIN
 PERFORM business.vnext_check_teaching_profile(p_tenant,NULL,p_role,p_actor);
 IF p_role='super_admin' AND p_actor IS NULL THEN RETURN true; END IF;
 IF p_id IS NULL THEN RETURN true; END IF;
 SELECT r.created_by_teacher_id INTO creator FROM business.rooms r
  WHERE r.tenant_id=p_tenant AND r.id=p_id AND r.legacy_deleted=false FOR UPDATE;
 IF NOT FOUND OR creator IS DISTINCT FROM p_actor THEN
  RAISE EXCEPTION 'VNEXT_TEACHER_ROOM_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_create_scoped_room(
 p_tenant_id text,p_room_id text,p_name text,p_address text,p_actor_role text,p_actor_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_room_actor(p_tenant_id,NULL,p_actor_role,p_actor_teacher_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('room-name:'||p_tenant_id||':'||p_name,0));
 RETURN QUERY SELECT * FROM business.vnext_create_room_v1(p_tenant_id,p_room_id,p_name,p_address);
 UPDATE business.rooms r SET created_by_teacher_id=CASE WHEN p_actor_role='teacher' THEN p_actor_teacher_id ELSE NULL END
  WHERE r.tenant_id=p_tenant_id AND r.id=p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION business.vnext_update_scoped_room(
 p_tenant text,p_id text,p_expected timestamptz,p_name text,p_address text,p_role text,p_actor text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_room_actor(p_tenant,p_id,p_role,p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('room-name:'||p_tenant||':'||p_name,0));
 IF EXISTS (SELECT 1 FROM business.rooms r WHERE r.tenant_id=p_tenant AND r.name=p_name AND r.id<>p_id AND r.legacy_deleted=false) THEN
  RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_NAME_EXISTS' USING ERRCODE='23505';
 END IF;
 RETURN QUERY UPDATE business.rooms r SET name=p_name,address_legacy=p_address,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',r.updated_at)+interval '1 millisecond')
  WHERE r.tenant_id=p_tenant AND r.id=p_id AND r.legacy_deleted=false AND r.updated_at=p_expected RETURNING r.id,r.updated_at;
END;
$$;

-- Original browserDatabase.deleteRoom removes only this resource. Keep lesson/course snapshots intact.
CREATE OR REPLACE FUNCTION business.vnext_soft_delete_room(p_tenant_id text,p_room_id text,p_expected_updated_at timestamptz)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_ROOM_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN QUERY UPDATE business.rooms r SET legacy_deleted=true,
  updated_at=GREATEST(date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',r.updated_at)+interval '1 millisecond')
  WHERE r.tenant_id=p_tenant_id AND r.id=p_room_id AND r.legacy_deleted=false AND r.updated_at=p_expected_updated_at RETURNING r.id,r.updated_at;
END;
$$;
CREATE OR REPLACE FUNCTION business.vnext_delete_scoped_room(p_tenant text,p_id text,p_expected timestamptz,p_role text,p_actor text)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM business.vnext_check_room_actor(p_tenant,p_id,p_role,p_actor);
 RETURN QUERY SELECT * FROM business.vnext_soft_delete_room(p_tenant,p_id,p_expected);
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_check_room_actor(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_scoped_room(text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_scoped_room(text,text,timestamptz,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_scoped_room(text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_room(text,text,text,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_scoped_room(text,text,timestamptz,text,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_scoped_room(text,text,timestamptz,text,text) TO vnext_pg17_writer;
COMMIT;
