BEGIN;

SET LOCAL ROLE vnext_pg17_business_owner;

CREATE TABLE business.question_taxonomy_systems (
  id text COLLATE "C" NOT NULL CHECK (id=btrim(id) AND id<>''),
  tenant_id text COLLATE "C" NOT NULL CHECK (tenant_id=btrim(tenant_id) AND tenant_id<>''),
  subject text NOT NULL CHECK (subject=btrim(subject) AND subject<>''),
  name text NOT NULL CHECK (name=btrim(name) AND name<>''),
  sort_order integer NOT NULL DEFAULT 0,
  deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id) REFERENCES business.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK ((deleted=false AND deleted_at IS NULL) OR (deleted=true AND deleted_at IS NOT NULL))
);
CREATE UNIQUE INDEX question_taxonomy_systems_name_unique
  ON business.question_taxonomy_systems(tenant_id,subject,lower(name)) WHERE deleted=false;

CREATE TABLE business.question_taxonomy_nodes (
  id text COLLATE "C" NOT NULL CHECK (id=btrim(id) AND id<>''),
  tenant_id text COLLATE "C" NOT NULL CHECK (tenant_id=btrim(tenant_id) AND tenant_id<>''),
  system_id text COLLATE "C" NOT NULL CHECK (system_id=btrim(system_id) AND system_id<>''),
  parent_id text COLLATE "C",
  name text NOT NULL CHECK (name=btrim(name) AND name<>''),
  sort_order integer NOT NULL DEFAULT 0,
  deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,system_id,id),
  FOREIGN KEY (tenant_id,system_id) REFERENCES business.question_taxonomy_systems(tenant_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,system_id,parent_id) REFERENCES business.question_taxonomy_nodes(tenant_id,system_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (parent_id IS NULL OR parent_id<>id),
  CHECK ((deleted=false AND deleted_at IS NULL) OR (deleted=true AND deleted_at IS NOT NULL))
);
CREATE INDEX question_taxonomy_nodes_tree_idx
  ON business.question_taxonomy_nodes(tenant_id,system_id,parent_id,sort_order,id) WHERE deleted=false;

CREATE OR REPLACE FUNCTION business.vnext_create_question_taxonomy_system_v1(
  p_tenant_id text,p_system_id text,p_subject text,p_name text,p_sort_order integer
) RETURNS TABLE(outcome text,id text,updated_at timestamptz,affected_question_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user NOT IN ('gewu_cloud_schedule_reader','vnext_pg17_writer') THEN RAISE EXCEPTION 'VNEXT_QUESTION_TAXONOMY_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM business.question_taxonomy_systems s WHERE s.tenant_id=p_tenant_id AND s.deleted=false AND (s.id=p_system_id OR (s.subject=p_subject AND lower(s.name)=lower(p_name)))) THEN
    RETURN QUERY SELECT 'conflict'::text,p_system_id,NULL::timestamptz,0; RETURN;
  END IF;
  INSERT INTO business.question_taxonomy_systems(id,tenant_id,subject,name,sort_order,created_at,updated_at)
  VALUES(p_system_id,p_tenant_id,p_subject,p_name,p_sort_order,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()));
  RETURN QUERY SELECT 'committed'::text,s.id,s.updated_at,0 FROM business.question_taxonomy_systems s WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_update_question_taxonomy_system_v1(
  p_tenant_id text,p_system_id text,p_expected_updated_at timestamptz,p_subject text,p_name text,p_sort_order integer
) RETURNS TABLE(outcome text,id text,updated_at timestamptz,affected_question_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user NOT IN ('gewu_cloud_schedule_reader','vnext_pg17_writer') THEN RAISE EXCEPTION 'VNEXT_QUESTION_TAXONOMY_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM business.question_taxonomy_systems s WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id AND s.deleted=false AND s.updated_at=p_expected_updated_at)
    OR EXISTS (SELECT 1 FROM business.question_taxonomy_systems s WHERE s.tenant_id=p_tenant_id AND s.id<>p_system_id AND s.deleted=false AND s.subject=p_subject AND lower(s.name)=lower(p_name)) THEN
    RETURN QUERY SELECT 'conflict'::text,p_system_id,NULL::timestamptz,0; RETURN;
  END IF;
  UPDATE business.question_taxonomy_systems s SET subject=p_subject,name=p_name,sort_order=p_sort_order,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id;
  RETURN QUERY SELECT 'committed'::text,s.id,s.updated_at,0 FROM business.question_taxonomy_systems s WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_delete_question_taxonomy_system_v1(
  p_tenant_id text,p_system_id text,p_expected_updated_at timestamptz,p_expected_affected_question_count integer
) RETURNS TABLE(outcome text,id text,updated_at timestamptz,affected_question_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_affected integer; v_updated timestamptz;
BEGIN
  IF session_user NOT IN ('gewu_cloud_schedule_reader','vnext_pg17_writer') THEN RAISE EXCEPTION 'VNEXT_QUESTION_TAXONOMY_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM business.question_taxonomy_systems s WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id AND s.deleted=false AND s.updated_at=p_expected_updated_at) THEN
    RETURN QUERY SELECT 'conflict'::text,p_system_id,NULL::timestamptz,0; RETURN;
  END IF;
  SELECT count(*)::integer INTO v_affected FROM business.questions q
   WHERE q.tenant_id=p_tenant_id AND q.deleted=false
     AND jsonb_typeof(q.taxonomy_json->'taxonomyIds'->p_system_id)='array'
     AND jsonb_array_length(q.taxonomy_json->'taxonomyIds'->p_system_id)>0;
  IF v_affected<>p_expected_affected_question_count THEN
    RETURN QUERY SELECT 'impact_changed'::text,p_system_id,NULL::timestamptz,v_affected; RETURN;
  END IF;
  UPDATE business.questions q SET taxonomy_json=jsonb_set(q.taxonomy_json,'{taxonomyIds}',
    (CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds')='object' THEN q.taxonomy_json->'taxonomyIds' ELSE '{}'::jsonb END)-p_system_id),
    updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE q.tenant_id=p_tenant_id AND q.deleted=false AND q.taxonomy_json->'taxonomyIds' ? p_system_id;
  UPDATE business.question_taxonomy_nodes n SET deleted=true,deleted_at=date_trunc('milliseconds',transaction_timestamp()),updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE n.tenant_id=p_tenant_id AND n.system_id=p_system_id AND n.deleted=false;
  UPDATE business.question_taxonomy_systems s SET deleted=true,deleted_at=date_trunc('milliseconds',transaction_timestamp()),updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id RETURNING s.updated_at INTO v_updated;
  RETURN QUERY SELECT 'committed'::text,p_system_id,v_updated,v_affected;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_create_question_taxonomy_node_v1(
  p_tenant_id text,p_node_id text,p_system_id text,p_parent_id text,p_name text,p_sort_order integer
) RETURNS TABLE(outcome text,id text,updated_at timestamptz,affected_question_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user NOT IN ('gewu_cloud_schedule_reader','vnext_pg17_writer') THEN RAISE EXCEPTION 'VNEXT_QUESTION_TAXONOMY_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM business.question_taxonomy_systems s WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id AND s.deleted=false)
    OR EXISTS (SELECT 1 FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id)
    OR (p_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.system_id=p_system_id AND n.id=p_parent_id AND n.deleted=false)) THEN
    RETURN QUERY SELECT 'conflict'::text,p_node_id,NULL::timestamptz,0; RETURN;
  END IF;
  INSERT INTO business.question_taxonomy_nodes(id,tenant_id,system_id,parent_id,name,sort_order,created_at,updated_at)
  VALUES(p_node_id,p_tenant_id,p_system_id,p_parent_id,p_name,p_sort_order,date_trunc('milliseconds',transaction_timestamp()),date_trunc('milliseconds',transaction_timestamp()));
  RETURN QUERY SELECT 'committed'::text,n.id,n.updated_at,0 FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_update_question_taxonomy_node_v1(
  p_tenant_id text,p_node_id text,p_expected_updated_at timestamptz,p_system_id text,p_parent_id text,p_name text,p_sort_order integer
) RETURNS TABLE(outcome text,id text,updated_at timestamptz,affected_question_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user NOT IN ('gewu_cloud_schedule_reader','vnext_pg17_writer') THEN RAISE EXCEPTION 'VNEXT_QUESTION_TAXONOMY_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id AND n.system_id=p_system_id AND n.deleted=false AND n.updated_at=p_expected_updated_at)
    OR (p_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_parent_id AND n.system_id=p_system_id AND n.deleted=false))
    OR EXISTS (WITH RECURSIVE descendants AS (SELECT n.id FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.system_id=p_system_id AND n.id=p_node_id UNION ALL SELECT child.id FROM business.question_taxonomy_nodes child JOIN descendants d ON child.parent_id=d.id WHERE child.tenant_id=p_tenant_id AND child.system_id=p_system_id AND child.deleted=false) SELECT 1 FROM descendants d WHERE d.id=p_parent_id) THEN
    RETURN QUERY SELECT 'conflict'::text,p_node_id,NULL::timestamptz,0; RETURN;
  END IF;
  UPDATE business.question_taxonomy_nodes n SET parent_id=p_parent_id,name=p_name,sort_order=p_sort_order,updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id;
  RETURN QUERY SELECT 'committed'::text,n.id,n.updated_at,0 FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id;
END; $$;

CREATE OR REPLACE FUNCTION business.vnext_delete_question_taxonomy_node_v1(
  p_tenant_id text,p_node_id text,p_expected_updated_at timestamptz,p_system_id text,p_expected_affected_question_count integer
) RETURNS TABLE(outcome text,id text,updated_at timestamptz,affected_question_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_descendants text[]; v_affected integer; v_updated timestamptz;
BEGIN
  IF session_user NOT IN ('gewu_cloud_schedule_reader','vnext_pg17_writer') THEN RAISE EXCEPTION 'VNEXT_QUESTION_TAXONOMY_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id AND n.system_id=p_system_id AND n.deleted=false AND n.updated_at=p_expected_updated_at) THEN
    RETURN QUERY SELECT 'conflict'::text,p_node_id,NULL::timestamptz,0; RETURN;
  END IF;
  WITH RECURSIVE descendants AS (
    SELECT n.id FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.system_id=p_system_id AND n.id=p_node_id AND n.deleted=false
    UNION ALL SELECT child.id FROM business.question_taxonomy_nodes child JOIN descendants d ON child.parent_id=d.id
      WHERE child.tenant_id=p_tenant_id AND child.system_id=p_system_id AND child.deleted=false
  ) SELECT array_agg(d.id) INTO v_descendants FROM descendants d;
  SELECT count(*)::integer INTO v_affected FROM business.questions q
   WHERE q.tenant_id=p_tenant_id AND q.deleted=false AND EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds'->p_system_id)='array' THEN q.taxonomy_json->'taxonomyIds'->p_system_id ELSE '[]'::jsonb END) item(value)
      WHERE item.value=ANY(v_descendants));
  IF v_affected<>p_expected_affected_question_count THEN
    RETURN QUERY SELECT 'impact_changed'::text,p_node_id,NULL::timestamptz,v_affected; RETURN;
  END IF;
  UPDATE business.questions q SET taxonomy_json=jsonb_set(q.taxonomy_json,ARRAY['taxonomyIds',p_system_id],
      to_jsonb(ARRAY(SELECT item.value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds'->p_system_id)='array' THEN q.taxonomy_json->'taxonomyIds'->p_system_id ELSE '[]'::jsonb END) item(value) WHERE NOT item.value=ANY(v_descendants)))),
      updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE q.tenant_id=p_tenant_id AND q.deleted=false AND EXISTS (
     SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds'->p_system_id)='array' THEN q.taxonomy_json->'taxonomyIds'->p_system_id ELSE '[]'::jsonb END) item(value)
      WHERE item.value=ANY(v_descendants));
  UPDATE business.question_taxonomy_nodes n SET deleted=true,deleted_at=date_trunc('milliseconds',transaction_timestamp()),updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE n.tenant_id=p_tenant_id AND n.system_id=p_system_id AND n.id=ANY(v_descendants);
  SELECT n.updated_at INTO v_updated FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id;
  RETURN QUERY SELECT 'committed'::text,p_node_id,v_updated,v_affected;
END; $$;

ALTER TABLE business.desktop_question_command_receipts DROP CONSTRAINT desktop_question_command_receipts_status_check;
ALTER TABLE business.desktop_question_command_receipts ADD CONSTRAINT desktop_question_command_receipts_status_check CHECK (status IN ('committed','rejected'));

REVOKE ALL ON TABLE business.question_taxonomy_systems FROM PUBLIC;
REVOKE ALL ON TABLE business.question_taxonomy_nodes FROM PUBLIC;
GRANT SELECT ON TABLE business.question_taxonomy_systems,business.question_taxonomy_nodes TO gewu_cloud_schedule_reader;
REVOKE ALL ON FUNCTION business.vnext_create_question_taxonomy_system_v1(text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_question_taxonomy_system_v1(text,text,timestamptz,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_question_taxonomy_system_v1(text,text,timestamptz,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_create_question_taxonomy_node_v1(text,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_update_question_taxonomy_node_v1(text,text,timestamptz,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_delete_question_taxonomy_node_v1(text,text,timestamptz,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_create_question_taxonomy_system_v1(text,text,text,text,integer) TO gewu_cloud_schedule_reader;
GRANT EXECUTE ON FUNCTION business.vnext_update_question_taxonomy_system_v1(text,text,timestamptz,text,text,integer) TO gewu_cloud_schedule_reader;
GRANT EXECUTE ON FUNCTION business.vnext_delete_question_taxonomy_system_v1(text,text,timestamptz,integer) TO gewu_cloud_schedule_reader;
GRANT EXECUTE ON FUNCTION business.vnext_create_question_taxonomy_node_v1(text,text,text,text,text,integer) TO gewu_cloud_schedule_reader;
GRANT EXECUTE ON FUNCTION business.vnext_update_question_taxonomy_node_v1(text,text,timestamptz,text,text,text,integer) TO gewu_cloud_schedule_reader;
GRANT EXECUTE ON FUNCTION business.vnext_delete_question_taxonomy_node_v1(text,text,timestamptz,text,integer) TO gewu_cloud_schedule_reader;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_question_taxonomy_system_v1(text,text,text,text,integer) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_question_taxonomy_system_v1(text,text,timestamptz,text,text,integer) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_question_taxonomy_system_v1(text,text,timestamptz,integer) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_create_question_taxonomy_node_v1(text,text,text,text,text,integer) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_update_question_taxonomy_node_v1(text,text,timestamptz,text,text,text,integer) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_delete_question_taxonomy_node_v1(text,text,timestamptz,text,integer) TO vnext_pg17_writer;

COMMIT;
