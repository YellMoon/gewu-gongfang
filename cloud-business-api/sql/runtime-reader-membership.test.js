'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260824-zz-runtime-reader-membership.sql'), 'utf8');
const projectionSql = fs.readFileSync(path.join(__dirname, '20260824-zzz-runtime-projection-read.sql'), 'utf8');
const runtimeRoleSql = fs.readFileSync(path.join(__dirname, '20260824-zzzz-runtime-projection-role.sql'), 'utf8');

assert.match(sql, /information_schema\.role_table_grants/);
assert.match(sql, /has_function_privilege\('gewu_cloud_schedule_reader',p\.oid,'EXECUTE'\)/);
assert.match(sql, /GRANT %s ON TABLE %I\.%I TO gewu_app/);
assert.match(sql, /has_table_privilege\(session_user,''business\.question_taxonomy_systems'',''SELECT''\)/);
assert.match(sql, /updated_definition = original_definition/);
assert.doesNotMatch(sql, /GRANT gewu_cloud_schedule_reader TO gewu_app/);
assert.match(projectionSql, /GRANT SELECT ON TABLE/);
for (const table of ['students', 'student_contact_directory', 'teachers', 'courses', 'course_student_pricings', 'schedules',
  'schedule_student_overrides', 'institutions', 'schools', 'rooms', 'grades', 'payments', 'consumptions',
  'personal_asset_records', 'personal_asset_manual_records', 'personal_asset_categories',
  'personal_asset_manual_categories', 'question_taxonomy_systems', 'question_taxonomy_nodes']) {
  assert.match(projectionSql, new RegExp(`business\\.${table}(?:,|\\s)`));
}
assert.doesNotMatch(projectionSql, /GRANT (?:INSERT|UPDATE|DELETE)/);
assert.match(runtimeRoleSql, /TO gewu_cloud_schedule_reader;/);
assert.match(runtimeRoleSql, /FROM gewu_app;/);
assert.match(runtimeRoleSql, /REVOKE %s ON TABLE %I\.%I FROM gewu_app/);
assert.match(runtimeRoleSql, /REVOKE EXECUTE ON FUNCTION %I\.%I\(%s\) FROM gewu_app/);
assert.doesNotMatch(runtimeRoleSql, /GRANT (?:INSERT|UPDATE|DELETE)/);

console.log('runtime reader membership migration checks passed');
