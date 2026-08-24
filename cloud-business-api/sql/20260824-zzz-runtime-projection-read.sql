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
TO gewu_app;

COMMIT;
