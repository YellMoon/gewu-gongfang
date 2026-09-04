'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260905-zz-question-import-parser-proof-binding.sql'), 'utf8');
assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /ADD COLUMN parser_contract_version smallint NOT NULL DEFAULT 0/u);
assert.match(sql, /ADD COLUMN parser_sha256 text COLLATE "C"/u);
assert.match(sql, /ADD COLUMN parser_runtime_receipt_id text COLLATE "C"/u);
assert.doesNotMatch(sql, /ALTER COLUMN parser_contract_version DROP DEFAULT/u,
  'the legacy version-0 default must remain available while an older cloud process is used for rollback');
assert.match(sql, /parser_contract_version=0[\s\S]*parser_sha256 IS NULL[\s\S]*parser_runtime_receipt_id IS NULL/u);
assert.match(sql, /parser_contract_version=1[\s\S]*parser_sha256 ~ '\^\[0-9a-f\]\{64\}\$'[\s\S]*parser_runtime_receipt_id IS NOT NULL/u);
assert.match(sql, /FOREIGN KEY \(parser_runtime_receipt_id,parser_sha256\)[\s\S]*REFERENCES business\.storage_agent_runtime_receipts\(receipt_id,parser_sha256\)/u,
  'a task proof must cite the exact parser digest on an immutable runtime receipt');
assert.match(sql, /question_import_parser_proof_no_update/u,
  'trusted parser proof columns must be immutable for the task lifetime');
assert.doesNotMatch(sql, /metadata_json\s*->>?\s*'parserSha256'/u,
  'user metadata must never be promoted into trusted parser proof columns');
console.log('question import parser-proof binding SQL checks passed');
