'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-zzz-teacher-lifecycle.sql'), 'utf8');
assert.match(sql, /vnext_create_teacher_v1/u);
assert.match(sql, /vnext_update_teacher_v1/u);
assert.match(sql, /vnext_soft_delete_teacher/u);
assert.match(sql, /legacy_deleted=true/u);
assert.match(sql, /business\.courses/u);
assert.match(sql, /SECURITY DEFINER/u);
console.log('teacher lifecycle SQL checks passed');
