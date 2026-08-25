'use strict';

const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync(__dirname + '/20260826-zz-role-application-least-privilege.sql', 'utf8');
assert.match(sql, /REVOKE ALL ON TABLE business\.cloud_role_applications FROM vnext_pg17_writer/);
assert.match(sql, /REVOKE EXECUTE ON FUNCTION business\.vnext_review_cloud_role_application_v1[\s\S]*FROM vnext_pg17_writer/);
assert.doesNotMatch(sql, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*ON TABLE business\.cloud_role_applications[\s\S]*TO vnext_pg17_(?:writer|identity_verifier)/);
for (const name of [
  'vnext_read_latest_cloud_role_application_v2',
  'vnext_submit_cloud_role_application_v2',
  'vnext_list_submitted_cloud_role_applications_v2',
  'vnext_review_cloud_role_application_v2',
]) {
  assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION business.${name}`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION business\\.${name}[\\s\\S]*TO vnext_pg17_identity_verifier`));
}
assert.ok(sql.includes("session_user <> 'vnext_pg17_identity_verifier'"));
assert.ok(sql.includes("role_grant.role='super_admin' AND role_grant.status='active'"));
console.log('role application least-privilege schema checks passed');
