'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-cloud-question-import-tasks.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /CREATE TABLE business\.question_import_tasks/u);
assert.match(sql, /CREATE TABLE business\.import_source_objects/u);
assert.match(sql, /CREATE TABLE business\.question_import_items/u);
assert.match(sql, /status text COLLATE "C" NOT NULL CHECK \(status IN \('awaiting_source_storage','queued_for_parse','parsing','candidates_ready','drafts_prepared','submitted','failed','cancelled','quarantined'\)\)/u);
assert.match(sql, /UNIQUE \(tenant_id,account_id,idempotency_key\)/u);
assert.match(sql, /UNIQUE \(import_task_id,item_index\)/u);
assert.match(sql, /REVOKE ALL ON TABLE business\.question_import_tasks, business\.import_source_objects, business\.question_import_items FROM PUBLIC;/u);
assert.doesNotMatch(sql, /plaintext|ciphertext|bytea|file_path|oss_url|nas[_ -]?path|smb:/iu,
  'cloud import tables must hold text metadata and NAS object references only');

console.log('cloud question import task SQL checks passed');
