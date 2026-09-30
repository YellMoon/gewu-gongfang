BEGIN;
GRANT USAGE ON SCHEMA business TO vnext_pg17_writer;
-- Immutable intent and immutable outcome: a missing outcome is explicitly unknown.
CREATE TABLE IF NOT EXISTS business.operation_audit_intents (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 actor_id text NOT NULL,
 actor_name text,
 device_id text,
 action text NOT NULL CHECK(action IN ('create','update','delete','command','task')),
 resource_type text NOT NULL,
 resource_id text,
 summary text NOT NULL,
 detail jsonb NOT NULL CHECK(jsonb_typeof(detail)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS business.operation_audit_results (
 id uuid PRIMARY KEY REFERENCES business.operation_audit_intents(id),
 status text NOT NULL CHECK(status IN ('success','conflict','error','rejected')),
 http_status integer NOT NULL CHECK(http_status BETWEEN 100 AND 599),
 code text,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS operation_audit_tenant_created ON business.operation_audit_intents(tenant_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS operation_audit_actor_created ON business.operation_audit_intents(tenant_id,actor_id,created_at DESC,id DESC);
CREATE OR REPLACE FUNCTION business.vnext_begin_operation_audit(p_id uuid,p_tenant text,p_actor text,p_name text,p_device text,p_action text,p_resource text,p_resource_id text,p_summary text,p_detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'OPERATION_AUDIT_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_tenant IS NULL OR length(p_tenant) NOT BETWEEN 1 AND 160 OR p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 160 OR length(p_resource)>80 OR length(p_summary)>160 OR octet_length(p_detail::text)>32768 THEN RAISE EXCEPTION 'OPERATION_AUDIT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO business.operation_audit_intents(id,tenant_id,actor_id,actor_name,device_id,action,resource_type,resource_id,summary,detail)
 VALUES(p_id,p_tenant,p_actor,p_name,p_device,p_action,p_resource,p_resource_id,p_summary,p_detail);
END; $$;
CREATE OR REPLACE FUNCTION business.vnext_complete_operation_audit(p_id uuid,p_status text,p_http integer,p_code text,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'OPERATION_AUDIT_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF octet_length(p_result::text)>32768 OR length(p_code)>160 THEN RAISE EXCEPTION 'OPERATION_AUDIT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO business.operation_audit_results(id,status,http_status,code,result) VALUES(p_id,p_status,p_http,p_code,p_result);
END; $$;
CREATE OR REPLACE FUNCTION business.vnext_list_operation_audits(p_tenant text,p_scope text,p_actor text,p_limit integer,p_offset integer,p_q text,p_action text,p_status text,p_from timestamptz,p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE audit_page jsonb;
BEGIN
 IF session_user<>'vnext_pg17_writer' THEN RAISE EXCEPTION 'OPERATION_AUDIT_WRITER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_scope IS NULL OR p_scope NOT IN ('tenant','self') OR p_actor IS NULL OR p_actor='' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'OPERATION_AUDIT_INVALID' USING ERRCODE='22023'; END IF;
 WITH filtered AS (
  SELECT i.*, COALESCE(r.status,'unknown') AS status,r.http_status,r.code,r.result,r.completed_at
  FROM business.operation_audit_intents i LEFT JOIN business.operation_audit_results r ON r.id=i.id
  WHERE i.tenant_id=p_tenant AND (p_scope='tenant' OR i.actor_id=p_actor)
   AND (p_action IS NULL OR i.action=p_action) AND (p_status IS NULL OR COALESCE(r.status,'unknown')=p_status)
   AND (p_from IS NULL OR i.created_at>=p_from) AND (p_to IS NULL OR i.created_at<=p_to)
   AND (p_q IS NULL OR strpos(lower(concat_ws(' ',i.actor_id,i.actor_name,i.device_id,i.action,i.resource_type,i.resource_id,r.result->>'id',i.summary,r.code)),lower(p_q))>0)
 ), page AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'id',id,'createdAt',created_at,'actorId',actor_id,'actorName',actor_name,'deviceId',device_id,'action',action,
  'resourceType',resource_type,'resourceId',COALESCE(resource_id,result->>'id'),'status',status,'summary',summary,
  'detail',detail || jsonb_build_object('httpStatus',http_status,'code',code,'result',result,'completedAt',completed_at)
 ) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb)) INTO audit_page;
 RETURN audit_page;
END; $$;
REVOKE ALL ON business.operation_audit_intents,business.operation_audit_results FROM PUBLIC,vnext_pg17_writer;
REVOKE ALL ON FUNCTION business.vnext_begin_operation_audit(uuid,text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_complete_operation_audit(uuid,text,integer,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_list_operation_audits(text,text,text,integer,integer,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_begin_operation_audit(uuid,text,text,text,text,text,text,text,text,jsonb) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_complete_operation_audit(uuid,text,integer,text,jsonb) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_list_operation_audits(text,text,text,integer,integer,text,text,text,timestamptz,timestamptz) TO vnext_pg17_writer;
COMMIT;
