-- UTF-8: retain a teacher's own created addresses after their last course moves away.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

ALTER TABLE business.rooms ADD COLUMN created_by_teacher_id text;
ALTER TABLE business.rooms ADD CONSTRAINT rooms_creator_teacher_tenant_fk
  FOREIGN KEY (tenant_id,created_by_teacher_id) REFERENCES business.teachers(tenant_id,id);
CREATE INDEX rooms_creator_teacher_idx ON business.rooms(tenant_id,created_by_teacher_id)
  WHERE legacy_deleted=false AND created_by_teacher_id IS NOT NULL;

CREATE OR REPLACE FUNCTION business.vnext_create_scoped_room(
  p_tenant_id text,p_room_id text,p_name text,p_address text,p_actor_role text,p_actor_teacher_id text
) RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM business.vnext_check_course_actor(p_tenant_id,NULL,p_actor_teacher_id,ARRAY[]::text[],p_actor_role,p_actor_teacher_id);
  RETURN QUERY SELECT * FROM business.vnext_create_room_v1(p_tenant_id,p_room_id,p_name,p_address);
  UPDATE business.rooms AS r SET created_by_teacher_id=CASE WHEN p_actor_role='teacher' THEN p_actor_teacher_id ELSE NULL END
    WHERE r.tenant_id=p_tenant_id AND r.id=p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION business.vnext_create_scoped_room(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_scoped_room(text,text,text,text,text,text) TO vnext_pg17_writer;
COMMIT;
