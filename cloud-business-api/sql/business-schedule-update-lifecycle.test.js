'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '20260901-business-schedule-update-lifecycle.sql'), 'utf8');
assert.match(source, /CREATE OR REPLACE FUNCTION business\.vnext_update_schedule_record_v3/u);
assert.match(source, /p_course_id text[\s\S]*p_recurring_rule text[\s\S]*p_service_type integer/u);
assert.match(source, /course_id=CASE WHEN p_course_id IS NULL THEN target\.course_id ELSE p_course_id END/u);
assert.match(source, /recurring_rule_json=CASE WHEN p_course_id IS NULL THEN target\.recurring_rule_json ELSE p_recurring_rule END/u);
assert.match(source, /service_type=CASE WHEN p_course_id IS NULL THEN target\.service_type ELSE p_service_type END/u);
assert.match(source, /jsonb_to_recordset\(p_pricings\)[\s\S]*attendance_status/u);
assert.match(source, /REVOKE ALL ON FUNCTION business\.vnext_update_schedule_record_v3/u);
assert.match(source, /GRANT EXECUTE ON FUNCTION business\.vnext_update_schedule_record_v3/u);

console.log('business schedule lifecycle update SQL checks passed');
