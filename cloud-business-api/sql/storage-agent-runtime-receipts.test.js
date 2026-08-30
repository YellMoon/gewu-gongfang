'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260830-storage-agent-runtime-receipts.sql'), 'utf8');
assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /CREATE TABLE business\.storage_agent_runtime_receipts/u);
assert.match(sql, /agent_version text[\s\S]*\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/u);
assert.match(sql, /jsonb_build_object\('questionPaperExport',3,'storageAgentTransport',2\)/u);
assert.match(sql, /storage agent runtime receipts are append-only/u);
assert.match(sql, /GRANT INSERT ON TABLE business\.storage_agent_runtime_receipts TO gewu_cloud_schedule_reader;/u);
assert.doesNotMatch(sql, /GRANT ALL|UPDATE ON TABLE business\.storage_agent_runtime_receipts|DELETE ON TABLE business\.storage_agent_runtime_receipts/iu);
console.log('storage agent runtime receipt SQL checks passed');
