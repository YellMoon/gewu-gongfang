'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '20260825-business-schedule-update-overrides.sql'), 'utf8');
assert.match(source, /CREATE OR REPLACE FUNCTION business\.vnext_update_schedule_record_v2/);
assert.match(source, /SECURITY DEFINER/);
assert.match(source, /target\.tenant_id=p_tenant_id AND target\.id=p_schedule_id[\s\S]*target\.updated_at=p_expected_updated_at/);
assert.match(source, /updated_at=date_trunc\('milliseconds', transaction_timestamp\(\)\)/);
assert.match(source, /jsonb_to_recordset\(p_pricings\)/);
assert.match(source, /IF p_pricings IS NOT NULL THEN[\s\S]*DELETE FROM business\.schedule_student_overrides/);
assert.match(source, /DELETE FROM business\.schedule_student_overrides/);
assert.match(source, /INSERT INTO business\.schedule_student_overrides/);
assert.match(source, /REVOKE ALL ON FUNCTION business\.vnext_update_schedule_record_v2[\s\S]*FROM PUBLIC/);
assert.match(source, /GRANT EXECUTE ON FUNCTION business\.vnext_update_schedule_record_v2[\s\S]*TO vnext_pg17_writer/);
assert.doesNotMatch(source, /GRANT[\s\S]*(PUBLIC|vnext_pg17_runtime|vnext_pg17_verifier)/);
console.log('business schedule update SQL checks passed');
