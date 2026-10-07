BEGIN;
SET LOCAL ROLE vnext_pg17_business_owner;
CREATE TABLE IF NOT EXISTS business.desktop_business_command_receipts (
 tenant_id text NOT NULL, actor_id text NOT NULL, command_id text NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 http_status integer CHECK(http_status BETWEEN 200 AND 499), response_body jsonb,
 completed_at timestamptz, PRIMARY KEY(tenant_id,actor_id,command_id),
 CHECK ((http_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
     OR (http_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION business.vnext_begin_business_command(p_tenant text,p_actor text,p_command text,p_payload text,p_request text)
RETURNS TABLE(http_status integer,response_body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,business AS $$
DECLARE r business.desktop_business_command_receipts%ROWTYPE;
BEGIN
 IF coalesce(p_tenant,'')='' OR coalesce(p_actor,'')='' OR coalesce(p_command,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
   OR coalesce(p_payload,'') !~ '^[0-9a-f]{64}$' OR coalesce(p_request,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COMMAND_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_tenant,p_actor,p_command)::text,0));
 SELECT * INTO r FROM business.desktop_business_command_receipts WHERE tenant_id=p_tenant AND actor_id=p_actor AND command_id=p_command;
 IF FOUND THEN
   IF r.payload_hash<>p_payload OR r.request_hash<>p_request THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COMMAND_HASH_MISMATCH'; END IF;
   RETURN QUERY SELECT r.http_status,r.response_body;
 ELSE
   INSERT INTO business.desktop_business_command_receipts(tenant_id,actor_id,command_id,payload_hash,request_hash) VALUES(p_tenant,p_actor,p_command,p_payload,p_request);
   RETURN QUERY SELECT NULL::integer,NULL::jsonb;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION business.vnext_finish_business_command(p_tenant text,p_actor text,p_command text,p_payload text,p_request text,p_status integer,p_body jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,business AS $$
BEGIN
 IF p_status NOT BETWEEN 200 AND 499 OR p_body IS NULL OR pg_column_size(p_body)>1048576 THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COMMAND_INVALID'; END IF;
 UPDATE business.desktop_business_command_receipts SET http_status=p_status,response_body=p_body,completed_at=clock_timestamp()
 WHERE tenant_id=p_tenant AND actor_id=p_actor AND command_id=p_command AND payload_hash=p_payload AND request_hash=p_request AND http_status IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'VNEXT_BUSINESS_COMMAND_HASH_MISMATCH'; END IF;
END $$;
REVOKE ALL ON business.desktop_business_command_receipts FROM PUBLIC,vnext_pg17_writer;
REVOKE ALL ON FUNCTION business.vnext_begin_business_command(text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION business.vnext_finish_business_command(text,text,text,text,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business.vnext_begin_business_command(text,text,text,text,text) TO vnext_pg17_writer;
GRANT EXECUTE ON FUNCTION business.vnext_finish_business_command(text,text,text,text,text,integer,jsonb) TO vnext_pg17_writer;
COMMIT;
