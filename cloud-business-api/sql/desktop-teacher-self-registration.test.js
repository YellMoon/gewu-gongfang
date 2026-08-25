'use strict';

const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync(__dirname + '/20260826-desktop-teacher-self-registration.sql', 'utf8');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION business.vnext_self_register_teacher_v1'));
assert.ok(sql.includes("session_user <> 'vnext_pg17_writer'"));
assert.ok(sql.includes('INSERT INTO business.miniapp_cloud_accounts'));
assert.ok(sql.includes("VALUES (p_account_id,'teacher','active','teacher',p_teacher_id,NULL)"));
assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION business.vnext_self_register_teacher_v1'));
assert.ok(sql.includes('TO vnext_pg17_writer'));
console.log('desktop teacher self-registration schema checks passed');
