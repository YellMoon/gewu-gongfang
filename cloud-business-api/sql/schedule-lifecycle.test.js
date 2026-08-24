'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '20260824-schedule-lifecycle.sql'), 'utf8');
assert.match(source, /CREATE OR REPLACE FUNCTION business\.vnext_create_schedule_record_v1/);
assert.match(source, /INSERT INTO business\.schedules/);
assert.match(source, /INSERT INTO business\.schedule_student_overrides/);
assert.match(source, /CREATE OR REPLACE FUNCTION business\.vnext_soft_delete_schedule/);
assert.match(source, /legacy_deleted=true/);
assert.match(source, /updated_at=p_expected_updated_at/);
assert.match(source, /session_user <> 'vnext_pg17_writer'/);
assert.match(source, /REVOKE ALL ON FUNCTION business\.vnext_create_schedule_record_v1/);
assert.match(source, /GRANT EXECUTE ON FUNCTION business\.vnext_soft_delete_schedule/);
console.log('schedule lifecycle sql checks passed');
