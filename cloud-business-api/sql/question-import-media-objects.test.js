'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-question-import-media-objects.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /CREATE TABLE business\.question_import_media_objects/u);
assert.match(sql, /import_task_id text COLLATE "C" NOT NULL REFERENCES business\.question_import_tasks\(task_id\)/u);
assert.match(sql, /storage_task_id text COLLATE "C" NOT NULL UNIQUE REFERENCES business\.storage_object_tasks\(task_id\)/u);
assert.match(sql, /UNIQUE \(import_task_id,item_index,asset_index\)/u);
assert.match(sql, /storage_state text COLLATE "C" NOT NULL CHECK \(storage_state IN \('queued','verified','quarantined'\)\)/u);
assert.match(sql, /REVOKE ALL ON TABLE business\.question_import_media_objects FROM PUBLIC;/u);
assert.doesNotMatch(sql, /plaintext|ciphertext|bytea|file_path|oss_url|nas[_ -]?path|smb:/iu);

console.log('question import media object SQL checks passed');
