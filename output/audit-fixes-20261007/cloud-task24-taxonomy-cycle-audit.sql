-- Read-only predeployment observation. Existing cycles require a business decision;
-- the atomic migration prevents new cycles and bounds deletion traversal.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
WITH RECURSIVE walk(tenant_id,system_id,id,parent_id,path,cycle) AS (
  SELECT n.tenant_id,n.system_id,n.id,n.parent_id,ARRAY[n.id]::text[],false
    FROM business.question_taxonomy_nodes n WHERE n.deleted=false
  UNION ALL
  SELECT w.tenant_id,w.system_id,n.id,n.parent_id,w.path||n.id,n.id=ANY(w.path)
    FROM walk w JOIN business.question_taxonomy_nodes n
      ON n.tenant_id=w.tenant_id AND n.system_id=w.system_id AND n.id=w.parent_id AND n.deleted=false
    WHERE w.cycle=false
)
SELECT DISTINCT tenant_id,system_id,id FROM walk WHERE cycle=true ORDER BY tenant_id,system_id,id;
COMMIT;
