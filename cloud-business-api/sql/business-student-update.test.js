'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-business-student-update.sql'), 'utf8');
assert.match(sql, /CREATE OR REPLACE FUNCTION business\.vnext_update_student\(/u);
assert.match(sql, /IF session_user <> 'vnext_pg17_writer'/u);
assert.match(sql, /s\.updated_at=p_expected_updated_at/u);
assert.match(sql, /legacy_deleted=false/u);
assert.match(sql, /SECURITY DEFINER/u);
assert.match(sql, /REVOKE ALL ON FUNCTION business\.vnext_update_student/u);
assert.match(sql, /GRANT EXECUTE ON FUNCTION business\.vnext_update_student/u);
console.log('business student update SQL checks passed');
