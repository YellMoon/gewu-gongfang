'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260827-course-lifecycle-qualified.sql'), 'utf8');
for (const functionName of ['vnext_create_course_record_v1', 'vnext_update_course_record_v1']) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION business.${functionName}`);
  const end = sql.indexOf('$$;', start);
  const definition = sql.slice(start, end);
  assert.ok(start >= 0 && end > start, `${functionName} definition is required`);
  assert.doesNotMatch(definition, /WHERE tenant_id=p_tenant_id AND id=/);
  assert.match(definition, /room_record\.tenant_id=p_tenant_id AND room_record\.id=p_room_id/);
  assert.match(definition, /teacher_record\.tenant_id=p_tenant_id AND teacher_record\.id=p_teacher_id/);
}
assert.match(sql, /UPDATE business\.courses AS target/);
assert.match(sql, /WHERE target\.tenant_id=p_tenant_id AND target\.id=p_course_id/);
assert.match(sql, /^BEGIN;/);
assert.match(sql, /COMMIT;\s*$/);
console.log('qualified course lifecycle migration checks passed');
