'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-z-business-student-record-contacts.sql'), 'utf8');
assert.match(sql, /CREATE OR REPLACE FUNCTION business\.vnext_update_student_record_v3\(/u);
assert.match(sql, /jsonb_to_recordset\(p_contacts\)/u);
assert.match(sql, /FOR UPDATE/u);
assert.match(sql, /current_contact_updated_at <> contact\.expected_updated_at/u);
assert.match(sql, /ON CONFLICT \(student_id,contact_slot\) DO UPDATE/u);
assert.match(sql, /SECURITY DEFINER/u);
assert.match(sql, /REVOKE ALL ON FUNCTION business\.vnext_update_student_record_v3/u);
console.log('business student record contacts SQL checks passed');
