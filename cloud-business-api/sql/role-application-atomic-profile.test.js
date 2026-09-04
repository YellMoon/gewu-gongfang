'use strict';

const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync(__dirname + '/20260901-role-application-atomic-profile.sql', 'utf8');

assert.ok(sql.includes('profile_name text'));
assert.ok(sql.includes('profile_phone text'));
assert.ok(sql.includes('profile_phone_hmac char(64)'));
assert.ok(sql.includes('requested_profile_id text'));
assert.ok(sql.includes('vnext_submit_cloud_role_application_v3'));
assert.ok(sql.includes('vnext_review_cloud_role_application_v3'));
assert.ok(sql.includes('VNEXT_ROLE_APPLICATION_IDEMPOTENCY_CONFLICT'));
assert.ok(sql.includes('VNEXT_ROLE_APPLICATION_PROFILE_ID_CONFLICT'));
assert.ok(sql.includes('VNEXT_ROLE_APPLICATION_PROFILE_NAME_CONFLICT'));
assert.ok(sql.includes('VNEXT_ROLE_APPLICATION_PROFILE_PHONE_CONFLICT'));
assert.ok(sql.includes('VNEXT_ROLE_APPLICATION_GUARDIAN_RELATION_REQUIRED'));
assert.ok(sql.includes("application_row.requested_identity='family_member' AND application_row.profile_mode <> 'existing'"));
assert.ok(sql.includes('INSERT INTO business.teachers'));
assert.ok(sql.includes('INSERT INTO business.students'));
assert.ok(sql.includes('INSERT INTO business.student_contact_directory'));
assert.doesNotMatch(sql, /wechat_handle\s*=|\.wechat_handle/u, 'role authentication must never match a display-only WeChat handle');
assert.ok(sql.indexOf('INSERT INTO business.teachers') < sql.indexOf('INSERT INTO business.miniapp_cloud_role_grants'));
assert.ok(sql.includes('application_row.status=p_decision'));
assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION business.vnext_review_cloud_role_application_v3'));

console.log('role application atomic profile migration checks passed');
