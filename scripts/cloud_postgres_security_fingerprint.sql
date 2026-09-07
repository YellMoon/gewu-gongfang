-- Stable across a same-cluster restore: object OIDs are deliberately excluded.
WITH objects AS (
  SELECT 'schema' AS kind, nspname AS identity, nspowner AS owner,
    COALESCE(nspacl, acldefault('n', nspowner)) AS acl, '' AS behavior
  FROM pg_namespace WHERE nspname IN ('business','vnext_control_plane')
  UNION ALL
  SELECT 'relation', n.nspname || '.' || c.relname, c.relowner,
    COALESCE(c.relacl, acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner)),
    c.relrowsecurity::text || ':' || c.relforcerowsecurity::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('business','vnext_control_plane') AND c.relkind IN ('r','p','v','m','S','f')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    p.proowner, COALESCE(p.proacl,acldefault('f',p.proowner)),
    p.prosecdef::text || ':' || COALESCE(p.proconfig::text,'')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('business','vnext_control_plane')
  UNION ALL
  SELECT 'default', COALESCE(n.nspname,'*') || ':' || d.defaclrole::regrole::text || ':' || d.defaclobjtype::text,
    d.defaclrole, d.defaclacl, ''
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
  WHERE n.nspname IN ('business','vnext_control_plane') OR d.defaclnamespace=0
), canonical AS (
  SELECT kind, identity, json_build_array(kind, identity, owner::regrole::text, behavior,
    (SELECT string_agg(json_build_array(a.grantor::regrole::text,a.grantee::regrole::text,
        a.privilege_type,a.is_grantable)::text, ',' ORDER BY a.grantor,a.grantee,a.privilege_type,a.is_grantable)
     FROM aclexplode(objects.acl) a))::text AS value
  FROM objects
)
SELECT md5(string_agg(value, E'\n' ORDER BY kind,identity)) FROM canonical;
