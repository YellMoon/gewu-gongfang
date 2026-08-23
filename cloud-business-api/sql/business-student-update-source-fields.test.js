'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-business-student-update-source-fields.sql'), 'utf8');

assert.match(sql, /CREATE OR REPLACE FUNCTION business\.vnext_update_student_v2\(/u);
assert.match(sql, /IF session_user <> 'vnext_pg17_writer'/u);
assert.match(sql, /legacy_source_type=p_legacy_source_type/u);
assert.match(sql, /student_source_legacy=p_student_source/u);
assert.match(sql, /s\.updated_at=p_expected_updated_at/u);
assert.match(sql, /SECURITY DEFINER/u);
assert.match(sql, /REVOKE ALL ON FUNCTION business\.vnext_update_student_v2/u);
assert.match(sql, /GRANT EXECUTE ON FUNCTION business\.vnext_update_student_v2/u);
console.log('business student update source fields SQL checks passed');
