'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260822-miniapp-cloud-role-profiles.sql'), 'utf8');
assert.match(sql, /ADD COLUMN profile_type text/u);
assert.match(sql, /ADD COLUMN profile_id text/u);
assert.match(sql, /role IN \('teacher','student'\) AND profile_type=role AND profile_id IS NOT NULL/u);
assert.match(sql, /CREATE UNIQUE INDEX miniapp_cloud_one_active_role/u);
assert.match(sql, /CREATE FUNCTION business\.miniapp_cloud_role_grant_profile_guard/u);
assert.match(sql, /FROM business\.teachers/u);
assert.match(sql, /FROM business\.students/u);
assert.match(sql, /REVOKE EXECUTE ON FUNCTION business\.miniapp_cloud_role_grant_profile_guard\(\) FROM PUBLIC;/u);
assert.doesNotMatch(sql, /phone_number|purePhoneNumber|13732250653/u);
console.log('miniapp cloud role profile SQL checks passed');
