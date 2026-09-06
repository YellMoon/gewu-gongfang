BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;

-- Advance question versions when taxonomy deletion changes question metadata.
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
  WITH target AS MATERIALIZED (
    SELECT q.id FROM business.questions q
    JOIN business.question_contents c ON c.tenant_id=q.tenant_id AND c.question_id=q.id
     WHERE q.tenant_id=p_tenant_id AND q.deleted=false AND c.deleted=false
       AND q.taxonomy_json->'taxonomyIds' ? p_system_id
     FOR UPDATE OF q,c
  ), advanced_content AS (
    UPDATE business.question_contents c SET version=c.version+1,updated_at=date_trunc('milliseconds',transaction_timestamp())
     FROM target
     WHERE c.tenant_id=p_tenant_id AND c.question_id=target.id AND c.deleted=false
     RETURNING c.question_id
  )
  UPDATE business.questions q SET taxonomy_json=jsonb_set(q.taxonomy_json,'{taxonomyIds}',
    (CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds')='object' THEN q.taxonomy_json->'taxonomyIds' ELSE '{}'::jsonb END)-p_system_id),
    updated_at=date_trunc('milliseconds',transaction_timestamp())
   FROM advanced_content c
   WHERE q.tenant_id=p_tenant_id AND q.id=c.question_id AND q.deleted=false;
  UPDATE business.question_taxonomy_nodes n SET deleted=true,deleted_at=date_trunc('milliseconds',transaction_timestamp()),updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE n.tenant_id=p_tenant_id AND n.system_id=p_system_id AND n.deleted=false;
  UPDATE business.question_taxonomy_systems s SET deleted=true,deleted_at=date_trunc('milliseconds',transaction_timestamp()),updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE s.tenant_id=p_tenant_id AND s.id=p_system_id RETURNING s.updated_at INTO v_updated;
  RETURN QUERY SELECT 'committed'::text,p_system_id,v_updated,v_affected;
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
  WITH target AS MATERIALIZED (
    SELECT q.id FROM business.questions q
    JOIN business.question_contents c ON c.tenant_id=q.tenant_id AND c.question_id=q.id
     WHERE q.tenant_id=p_tenant_id AND q.deleted=false AND c.deleted=false AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds'->p_system_id)='array' THEN q.taxonomy_json->'taxonomyIds'->p_system_id ELSE '[]'::jsonb END) item(value)
        WHERE item.value=ANY(v_descendants))
     FOR UPDATE OF q,c
  ), advanced_content AS (
    UPDATE business.question_contents c SET version=c.version+1,updated_at=date_trunc('milliseconds',transaction_timestamp())
     FROM target
     WHERE c.tenant_id=p_tenant_id AND c.question_id=target.id AND c.deleted=false
     RETURNING c.question_id
  )
  UPDATE business.questions q SET taxonomy_json=jsonb_set(q.taxonomy_json,ARRAY['taxonomyIds',p_system_id],
      to_jsonb(ARRAY(SELECT item.value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds'->p_system_id)='array' THEN q.taxonomy_json->'taxonomyIds'->p_system_id ELSE '[]'::jsonb END) item(value) WHERE NOT item.value=ANY(v_descendants)))),
      updated_at=date_trunc('milliseconds',transaction_timestamp())
   FROM advanced_content c
   WHERE q.tenant_id=p_tenant_id AND q.id=c.question_id AND q.deleted=false;
  UPDATE business.question_taxonomy_nodes n SET deleted=true,deleted_at=date_trunc('milliseconds',transaction_timestamp()),updated_at=date_trunc('milliseconds',transaction_timestamp())
   WHERE n.tenant_id=p_tenant_id AND n.system_id=p_system_id AND n.id=ANY(v_descendants);
  SELECT n.updated_at INTO v_updated FROM business.question_taxonomy_nodes n WHERE n.tenant_id=p_tenant_id AND n.id=p_node_id;
  RETURN QUERY SELECT 'committed'::text,p_node_id,v_updated,v_affected;
END; $$;

COMMIT;
