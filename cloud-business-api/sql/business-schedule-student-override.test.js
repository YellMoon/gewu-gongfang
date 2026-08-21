'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '20260822-business-schedule-student-override.sql'), 'utf8');

assert.match(source, /CREATE OR REPLACE FUNCTION business\.vnext_upsert_schedule_student_override/);
assert.match(source, /SECURITY DEFINER/);
assert.match(source, /session_user <> 'vnext_pg17_writer'/);
assert.match(source, /UPDATE business\.schedules AS s/);
assert.match(source, /updated_at=date_trunc\('milliseconds', transaction_timestamp\(\)\)/);
assert.match(source, /INSERT INTO business\.schedule_student_overrides/);
assert.match(source, /ON CONFLICT \(tenant_id, schedule_id, student_id\) DO UPDATE/);
assert.match(source, /REVOKE ALL ON FUNCTION business\.vnext_upsert_schedule_student_override[\s\S]*FROM PUBLIC/);
assert.match(source, /GRANT EXECUTE ON FUNCTION business\.vnext_upsert_schedule_student_override[\s\S]*TO vnext_pg17_writer/);

console.log('business schedule student override SQL checks passed');
