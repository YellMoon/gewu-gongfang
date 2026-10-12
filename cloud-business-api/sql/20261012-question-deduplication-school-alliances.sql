BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

ALTER TABLE business.schools ADD COLUMN kind text NOT NULL DEFAULT 'school' CHECK (kind IN ('school','alliance'));
ALTER TABLE business.schools ADD COLUMN member_school_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(member_school_ids)='array');
ALTER TABLE business.questions ADD COLUMN organization_type text;
ALTER TABLE business.questions ADD COLUMN metadata_labels jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_labels)='object');
ALTER TABLE business.questions ADD COLUMN school_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(school_ids)='array');
UPDATE business.questions q SET school_ids=jsonb_build_array(s.id)
FROM business.schools s WHERE s.tenant_id=q.tenant_id AND NOT s.legacy_deleted AND s.name=q.school;

CREATE FUNCTION business.vnext_guard_student_school_kind() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.legacy_deleted OR NULLIF(btrim(NEW.school_legacy),'') IS NULL THEN RETURN NEW; END IF;
  IF session_user='vnext_pg17_writer' THEN
    INSERT INTO business.schools(id,tenant_id,name,legacy_count,legacy_deleted,created_at,updated_at)
    VALUES(gen_random_uuid()::text,NEW.tenant_id,NEW.school_legacy,1,false,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()))
    ON CONFLICT (tenant_id,name) WHERE legacy_deleted=false DO NOTHING;
  END IF;
  PERFORM 1 FROM business.schools WHERE tenant_id=NEW.tenant_id AND name=NEW.school_legacy AND NOT legacy_deleted FOR SHARE;
  IF EXISTS (SELECT 1 FROM business.schools WHERE tenant_id=NEW.tenant_id AND name=NEW.school_legacy AND NOT legacy_deleted AND kind='alliance') THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_STUDENT_SCHOOL_ALLIANCE_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vnext_student_school_kind BEFORE INSERT OR UPDATE OF school_legacy,legacy_deleted ON business.students
FOR EACH ROW EXECUTE FUNCTION business.vnext_guard_student_school_kind();

CREATE FUNCTION business.vnext_guard_school_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  -- UTF-8: a school can participate in multiple alliances, across cities.
  IF (NEW.kind='alliance' OR NEW.legacy_deleted) AND EXISTS
    (SELECT 1 FROM business.schools a WHERE a.tenant_id=NEW.tenant_id AND NOT a.legacy_deleted AND a.kind='alliance' AND a.member_school_ids ? NEW.id) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_ALLIANCE_REFERENCED' USING ERRCODE='P0001';
  END IF;
  IF (NEW.kind='alliance' OR NEW.legacy_deleted) AND EXISTS
    (SELECT 1 FROM business.students WHERE tenant_id=NEW.tenant_id AND school_legacy=OLD.name AND NOT legacy_deleted) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_REFERENCED' USING ERRCODE='P0001';
  END IF;
  IF NEW.legacy_deleted AND EXISTS (SELECT 1 FROM business.questions WHERE tenant_id=NEW.tenant_id AND NOT deleted AND school_ids ? NEW.id) THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_QUESTION_REFERENCED' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vnext_school_reference_guard BEFORE UPDATE ON business.schools
FOR EACH ROW EXECUTE FUNCTION business.vnext_guard_school_references();

CREATE FUNCTION business.vnext_guard_alliance_members() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE selected_id text;
BEGIN
  IF NEW.kind='school' AND jsonb_array_length(NEW.member_school_ids)>0 THEN
    RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_MEMBERS_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  FOR selected_id IN SELECT jsonb_array_elements_text(NEW.member_school_ids) ORDER BY 1 LOOP
    PERFORM 1 FROM business.schools WHERE tenant_id=NEW.tenant_id AND id=selected_id AND kind='school' AND NOT legacy_deleted FOR SHARE;
    IF NOT FOUND OR selected_id=NEW.id THEN RAISE EXCEPTION 'VNEXT_BUSINESS_ALLIANCE_MEMBER_SCHOOL_INVALID' USING ERRCODE='P0001'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER vnext_alliance_members BEFORE INSERT OR UPDATE OF kind,member_school_ids ON business.schools
FOR EACH ROW EXECUTE FUNCTION business.vnext_guard_alliance_members();

CREATE FUNCTION business.vnext_guard_question_school_ids() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE selected_id text;
BEGIN
  FOR selected_id IN SELECT jsonb_array_elements_text(NEW.school_ids) LOOP
    PERFORM 1 FROM business.schools WHERE tenant_id=NEW.tenant_id AND id=selected_id AND NOT legacy_deleted FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_QUESTION_SCHOOL_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER vnext_question_school_ids BEFORE INSERT OR UPDATE OF school_ids ON business.questions
FOR EACH ROW EXECUTE FUNCTION business.vnext_guard_question_school_ids();

CREATE FUNCTION business.vnext_create_school_v2(p_tenant_id text,p_school_id text,p_name text,p_count integer,p_kind text,p_members jsonb DEFAULT NULL)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_kind NOT IN ('school','alliance') OR p_kind IS NULL THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_KIND_INVALID'; END IF;
  RETURN QUERY SELECT * FROM business.vnext_create_school_v1(p_tenant_id,p_school_id,p_name,p_count);
  UPDATE business.schools SET kind=p_kind,member_school_ids=COALESCE(p_members,'[]'::jsonb) WHERE tenant_id=p_tenant_id AND business.schools.id=p_school_id;
END $$;
CREATE FUNCTION business.vnext_update_school_v2(p_tenant_id text,p_school_id text,p_expected_updated_at timestamptz,p_name text,p_count integer,p_kind text,p_members jsonb DEFAULT NULL)
RETURNS TABLE(id text,updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE changed_id text; changed_at timestamptz;
BEGIN
  IF p_kind NOT IN ('school','alliance') OR p_kind IS NULL THEN RAISE EXCEPTION 'VNEXT_BUSINESS_SCHOOL_KIND_INVALID'; END IF;
  SELECT * INTO changed_id,changed_at FROM business.vnext_update_school_v1(p_tenant_id,p_school_id,p_expected_updated_at,p_name,p_count);
  IF changed_id IS NULL THEN RETURN; END IF;
  UPDATE business.schools SET kind=p_kind,member_school_ids=COALESCE(p_members,member_school_ids) WHERE tenant_id=p_tenant_id AND business.schools.id=p_school_id;
  id:=changed_id; updated_at:=changed_at; RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION business.vnext_guard_student_school_kind(),business.vnext_guard_school_references(),business.vnext_guard_alliance_members(),business.vnext_guard_question_school_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_school_v2(text,text,text,integer,text,jsonb),business.vnext_update_school_v2(text,text,timestamptz,text,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_school_v2(text,text,text,integer,text,jsonb),business.vnext_update_school_v2(text,text,timestamptz,text,integer,text,jsonb) TO vnext_pg17_writer;
COMMIT;
