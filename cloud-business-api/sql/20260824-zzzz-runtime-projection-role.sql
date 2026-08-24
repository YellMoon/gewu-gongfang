BEGIN;

GRANT SELECT ON TABLE
  business.students,
  business.student_contact_directory,
  business.teachers,
  business.courses,
  business.course_student_pricings,
  business.schedules,
  business.schedule_student_overrides,
  business.institutions,
  business.schools,
  business.rooms,
  business.grades,
  business.payments,
  business.consumptions,
  business.personal_asset_records,
  business.personal_asset_manual_records,
  business.personal_asset_categories,
  business.personal_asset_manual_categories,
  business.question_taxonomy_systems,
  business.question_taxonomy_nodes
TO gewu_cloud_schedule_reader;

DO $$
DECLARE
  grant_row record;
BEGIN
  FOR grant_row IN
    SELECT table_schema,table_name,string_agg(privilege_type,',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
     WHERE grantee='gewu_cloud_schedule_reader' AND table_schema='business'
     GROUP BY table_schema,table_name
  LOOP
    EXECUTE format('REVOKE %s ON TABLE %I.%I FROM gewu_app',grant_row.privileges,grant_row.table_schema,grant_row.table_name);
  END LOOP;

  FOR grant_row IN
    SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='business' AND has_function_privilege('gewu_cloud_schedule_reader',p.oid,'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM gewu_app',grant_row.nspname,grant_row.proname,grant_row.arguments);
  END LOOP;
END $$;

REVOKE SELECT ON TABLE
  business.students,
  business.student_contact_directory,
  business.teachers,
  business.courses,
  business.course_student_pricings,
  business.schedules,
  business.schedule_student_overrides,
  business.institutions,
  business.schools,
  business.rooms,
  business.grades,
  business.payments,
  business.consumptions,
  business.personal_asset_records,
  business.personal_asset_manual_records,
  business.personal_asset_categories,
  business.personal_asset_manual_categories,
  business.question_taxonomy_systems,
  business.question_taxonomy_nodes
FROM gewu_app;

COMMIT;
