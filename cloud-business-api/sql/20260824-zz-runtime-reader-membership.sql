BEGIN;

GRANT USAGE ON SCHEMA business TO gewu_app;

DO $$
DECLARE
  grant_row record;
  function_row record;
  original_definition text;
  updated_definition text;
BEGIN
  FOR grant_row IN
    SELECT table_schema,table_name,string_agg(privilege_type,',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
     WHERE grantee='gewu_cloud_schedule_reader' AND table_schema='business'
     GROUP BY table_schema,table_name
  LOOP
    EXECUTE format('GRANT %s ON TABLE %I.%I TO gewu_app',grant_row.privileges,grant_row.table_schema,grant_row.table_name);
  END LOOP;

  FOR grant_row IN
    SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='business' AND has_function_privilege('gewu_cloud_schedule_reader',p.oid,'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO gewu_app',grant_row.nspname,grant_row.proname,grant_row.arguments);
  END LOOP;

  FOR function_row IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='business'
       AND p.proname IN (
         'vnext_create_question_taxonomy_system_v1',
         'vnext_update_question_taxonomy_system_v1',
         'vnext_delete_question_taxonomy_system_v1',
         'vnext_create_question_taxonomy_node_v1',
         'vnext_update_question_taxonomy_node_v1',
         'vnext_delete_question_taxonomy_node_v1'
       )
  LOOP
    original_definition := pg_get_functiondef(function_row.oid);
    updated_definition := replace(
      original_definition,
      'IF session_user NOT IN (''gewu_cloud_schedule_reader'',''vnext_pg17_writer'') THEN',
      'IF session_user <> ''vnext_pg17_writer'' AND NOT has_table_privilege(session_user,''business.question_taxonomy_systems'',''SELECT'') THEN'
    );
    IF updated_definition = original_definition THEN
      RAISE EXCEPTION 'QUESTION_TAXONOMY_RUNTIME_ROLE_GUARD_NOT_FOUND';
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END $$;

COMMIT;
