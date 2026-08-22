'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260822-miniapp-student-access.sql'), 'utf8');

assert.match(sql, /ADD COLUMN student_relationship text/u);
assert.match(sql, /role='student' AND student_relationship IN \('student','guardian'\)/u);
assert.match(sql, /role<>'student' AND student_relationship IS NULL/u);
assert.match(sql, /CREATE FUNCTION business\.miniapp_cloud_student_access_guard\(\)/u);
assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('miniapp-student-access:' \|\| NEW\.profile_id, 19\)\)/u);
assert.match(sql, /VNEXT_STUDENT_ACCESS_SELF_CONFLICT/u);
assert.match(sql, /VNEXT_STUDENT_ACCESS_GUARDIAN_LIMIT/u);
assert.match(sql, /CREATE TRIGGER miniapp_cloud_student_access_guard/u);
assert.match(sql, /REVOKE EXECUTE ON FUNCTION business\.miniapp_cloud_student_access_guard\(\) FROM PUBLIC;/u);
assert.doesNotMatch(sql, /phone_number|purePhoneNumber|wechat_id|open_id|union_id/u);

console.log('miniapp student access SQL checks passed');
