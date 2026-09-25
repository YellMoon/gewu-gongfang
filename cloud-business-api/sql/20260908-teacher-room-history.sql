-- UTF-8: historical use is evidence of address access, not evidence of authorship.
BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

CREATE UNIQUE INDEX rooms_tenant_room_history_fk_idx ON business.rooms(tenant_id,id);
CREATE TABLE business.teacher_room_history (
  tenant_id text NOT NULL,
  teacher_id text NOT NULL,
  room_id text NOT NULL,
  first_course_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,teacher_id,room_id),
  FOREIGN KEY (tenant_id,teacher_id) REFERENCES business.teachers(tenant_id,id),
  FOREIGN KEY (tenant_id,room_id) REFERENCES business.rooms(tenant_id,id)
);
CREATE INDEX teacher_room_history_room_idx ON business.teacher_room_history(tenant_id,room_id);
REVOKE ALL ON TABLE business.teacher_room_history FROM PUBLIC;
GRANT SELECT ON TABLE business.teacher_room_history TO gewu_cloud_schedule_reader;

-- Only current, non-deleted, same-tenant course relationships are admitted.
INSERT INTO business.teacher_room_history(tenant_id,teacher_id,room_id,first_course_id)
SELECT DISTINCT ON (c.tenant_id,c.teacher_id,r.id) c.tenant_id,c.teacher_id,r.id,c.id
FROM business.courses c
JOIN business.teachers t ON t.tenant_id=c.tenant_id AND t.id=c.teacher_id AND t.legacy_deleted=false
JOIN business.rooms r ON r.tenant_id=c.tenant_id AND r.id=c.legacy_room_id AND r.legacy_deleted=false
WHERE c.legacy_deleted=false
ORDER BY c.tenant_id,c.teacher_id,r.id,c.id;

CREATE FUNCTION business.vnext_record_course_room_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_old_tenant text; v_old_teacher text; v_old_room text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.legacy_deleted=false THEN
    v_old_tenant:=OLD.tenant_id; v_old_teacher:=OLD.teacher_id; v_old_room:=OLD.legacy_room_id;
  END IF;
  INSERT INTO business.teacher_room_history(tenant_id,teacher_id,room_id,first_course_id)
  SELECT DISTINCT x.tenant_id,x.teacher_id,r.id,NEW.id
  FROM (VALUES (v_old_tenant,v_old_teacher,v_old_room),
    (CASE WHEN NEW.legacy_deleted=false THEN NEW.tenant_id END,NEW.teacher_id,NEW.legacy_room_id)) x(tenant_id,teacher_id,room_id)
  JOIN business.teachers t ON t.tenant_id=x.tenant_id AND t.id=x.teacher_id AND t.legacy_deleted=false
  JOIN business.rooms r ON r.tenant_id=x.tenant_id AND r.id=x.room_id AND r.legacy_deleted=false
  ORDER BY x.tenant_id,x.teacher_id,r.id
  ON CONFLICT (tenant_id,teacher_id,room_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION business.vnext_record_course_room_history() FROM PUBLIC;
CREATE TRIGGER course_room_history AFTER INSERT OR UPDATE OF tenant_id,teacher_id,legacy_room_id,legacy_deleted
  ON business.courses FOR EACH ROW EXECUTE FUNCTION business.vnext_record_course_room_history();
COMMIT;
