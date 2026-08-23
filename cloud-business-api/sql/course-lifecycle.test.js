'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-zzzzz-course-lifecycle.sql'), 'utf8');
assert.match(sql, /vnext_create_course_record_v1/u);
assert.match(sql, /vnext_update_course_record_v1/u);
assert.match(sql, /vnext_soft_delete_course/u);
assert.match(sql, /course_student_pricings/u);
assert.match(sql, /schedule_student_overrides/u);
assert.match(sql, /UPDATE business\.schedules/u);
assert.match(sql, /SECURITY DEFINER/u);
console.log('course lifecycle SQL checks passed');
