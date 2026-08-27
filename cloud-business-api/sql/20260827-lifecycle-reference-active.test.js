'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260827-lifecycle-reference-active.sql'), 'utf8');
assert.match(sql, /course_record\.legacy_deleted=false/);
assert.match(sql, /schedule_record\.legacy_deleted=false/);
assert.match(sql, /schedule_record\.course_id=p_course_id/);
assert.match(sql, /UPDATE business\.students AS target/);
assert.match(sql, /UPDATE business\.courses AS target/);
assert.match(sql, /^BEGIN;/);
assert.match(sql, /COMMIT;\s*$/);
console.log('active lifecycle reference migration checks passed');
