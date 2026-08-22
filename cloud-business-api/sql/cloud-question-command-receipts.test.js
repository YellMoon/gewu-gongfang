'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-cloud-question-command-receipts.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /CREATE TABLE business\.desktop_question_command_receipts/u);
assert.match(sql, /PRIMARY KEY \(tenant_id,command_id\)/u);
assert.match(sql, /payload_hash text COLLATE "C" NOT NULL CHECK \(payload_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/u);
assert.match(sql, /result_json jsonb NOT NULL CHECK \(jsonb_typeof\(result_json\)='object'\)/u);
assert.match(sql, /GRANT SELECT,INSERT ON TABLE business\.desktop_question_command_receipts TO gewu_cloud_schedule_reader;/u);
assert.doesNotMatch(sql, /session_token|authorization|file_path|oss_url|storage_state|nas[_ -]?path/iu);

console.log('cloud question command receipt SQL checks passed');
