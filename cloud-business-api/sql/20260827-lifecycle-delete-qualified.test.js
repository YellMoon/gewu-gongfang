'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260827-lifecycle-delete-qualified.sql'), 'utf8');

for (const [functionName, table] of [
  ['vnext_soft_delete_teacher', 'teachers'],
  ['vnext_soft_delete_room', 'rooms'],
  ['vnext_soft_delete_student', 'students'],
  ['vnext_soft_delete_course', 'courses'],
]) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION business.${functionName}`);
  const end = sql.indexOf('$$;', start);
  const definition = sql.slice(start, end);
  assert.ok(start >= 0 && end > start, `${functionName} definition is required`);
  assert.match(definition, new RegExp(`UPDATE business\\.${table} AS target`));
  assert.match(definition, /WHERE target\.tenant_id=p_tenant_id AND target\.id=/);
  assert.match(definition, /RETURNING target\.id,target\.updated_at INTO id,updated_at/);
}
assert.match(sql, /^BEGIN;/);
assert.match(sql, /COMMIT;\s*$/);
console.log('qualified lifecycle delete migration checks passed');
