'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-encrypted-import-source-relay.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /CREATE TABLE business\.encrypted_import_source_relays/u);
assert.match(sql, /storage_task_id text COLLATE "C" PRIMARY KEY REFERENCES business\.storage_object_tasks\(task_id\)/u);
assert.match(sql, /import_task_id text COLLATE "C" NOT NULL UNIQUE REFERENCES business\.question_import_tasks\(task_id\)/u);
assert.match(sql, /ciphertext bytea NOT NULL CHECK \(octet_length\(ciphertext\) BETWEEN 1 AND 67108864\)/u);
assert.match(sql, /REVOKE ALL ON TABLE business\.encrypted_import_source_relays FROM PUBLIC;/u);
assert.doesNotMatch(sql, /plaintext|file_path|oss_url|storage_state|nas[_ -]?path|smb:/iu);

console.log('encrypted import source relay SQL checks passed');
