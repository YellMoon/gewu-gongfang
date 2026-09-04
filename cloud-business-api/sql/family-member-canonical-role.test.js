'use strict';

const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync('cloud-business-api/sql/20260901-zz-family-member-canonical-role.sql', 'utf8');
const repository = fs.readFileSync('cloud-business-api/src/miniappRoleApplicationRepository.js', 'utf8');

assert.match(sql, /role IN \('super_admin','teacher','student','family_member'\)/u);
assert.match(sql, /SET role='family_member'/u);
assert.match(sql, /role='family_member' AND profile_type='student'/u);
assert.match(sql, /role='family_member' AND student_relationship='guardian'/u);
assert.match(sql, /CREATE OR REPLACE FUNCTION business\.vnext_review_cloud_role_application_v4/u);
assert.match(sql, /grant_role := application_row\.requested_identity/u);
assert.match(sql, /grant_profile_type := CASE WHEN grant_role='family_member' THEN 'student' ELSE grant_role END/u);
assert.match(sql, /DROP FUNCTION business\.vnext_review_cloud_role_application_v3/u);
assert.match(sql, /REVOKE EXECUTE ON FUNCTION business\.vnext_review_cloud_role_application_v4[\s\S]*FROM PUBLIC/u);
assert.match(sql, /GRANT EXECUTE ON FUNCTION business\.vnext_review_cloud_role_application_v4[\s\S]*TO vnext_pg17_identity_verifier/u);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION business\.vnext_review_cloud_role_application_v4[\s\S]*TO (?:vnext_pg17_writer|vnext_pg17_runtime)/u);
assert.match(repository, /vnext_review_cloud_role_application_v4/u);

console.log('family-member canonical business role migration checks passed');
