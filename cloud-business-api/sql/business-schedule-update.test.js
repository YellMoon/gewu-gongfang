'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '20260821-business-schedule-update.sql'), 'utf8');
assert.match(source, /CREATE OR REPLACE FUNCTION business\.vnext_update_schedule/);
assert.match(source, /SECURITY DEFINER/);
assert.match(source, /WHERE s\.tenant_id=p_tenant_id AND s\.id=p_schedule_id AND s\.updated_at=p_expected_updated_at/);
assert.match(source, /updated_at=date_trunc\('milliseconds', transaction_timestamp\(\)\)/);
assert.match(source, /REVOKE ALL ON FUNCTION business\.vnext_update_schedule[\s\S]*FROM PUBLIC/);
assert.match(source, /GRANT EXECUTE ON FUNCTION business\.vnext_update_schedule[\s\S]*TO vnext_pg17_writer/);
assert.doesNotMatch(source, /GRANT[\s\S]*(PUBLIC|vnext_pg17_runtime|vnext_pg17_verifier)/);
console.log('business schedule update SQL checks passed');
