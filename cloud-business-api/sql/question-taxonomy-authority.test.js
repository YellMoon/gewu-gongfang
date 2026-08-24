'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '20260824-question-taxonomy-authority.sql'), 'utf8');

for (const table of ['question_taxonomy_systems', 'question_taxonomy_nodes']) {
  assert.match(sql, new RegExp(`CREATE TABLE business\\.${table}`));
  assert.match(sql, new RegExp(`REVOKE ALL ON TABLE business\\.${table} FROM PUBLIC`));
}
for (const fn of [
  'vnext_create_question_taxonomy_system_v1', 'vnext_update_question_taxonomy_system_v1',
  'vnext_delete_question_taxonomy_system_v1', 'vnext_create_question_taxonomy_node_v1',
  'vnext_update_question_taxonomy_node_v1', 'vnext_delete_question_taxonomy_node_v1',
]) {
  assert.match(sql, new RegExp(`FUNCTION business\\.${fn}`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION business\\.${fn}`));
}
assert.match(sql, /p_expected_updated_at timestamptz/);
assert.match(sql, /p_expected_affected_question_count integer/);
assert.match(sql, /taxonomy_json/);
assert.match(sql, /session_user NOT IN \('gewu_cloud_schedule_reader','vnext_pg17_writer'\)/);
assert.match(sql, /status IN \('committed','rejected'\)/);
console.log('question taxonomy authority SQL checks passed');
