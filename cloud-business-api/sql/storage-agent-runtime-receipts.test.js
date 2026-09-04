'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const originalSql = fs.readFileSync(path.join(__dirname, '20260830-storage-agent-runtime-receipts.sql'), 'utf8');
const parserProofSql = fs.readFileSync(path.join(__dirname, '20260905-storage-agent-runtime-parser-proof.sql'), 'utf8');
assert.match(originalSql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(originalSql, /CREATE TABLE business\.storage_agent_runtime_receipts/u);
assert.match(originalSql, /agent_version text[\s\S]*\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/u);
assert.match(originalSql, /jsonb_build_object\('questionPaperExport',3,'storageAgentTransport',2\)/u);
assert.match(originalSql, /storage agent runtime receipts are append-only/u);
assert.match(originalSql, /GRANT INSERT ON TABLE business\.storage_agent_runtime_receipts TO gewu_cloud_schedule_reader;/u);
assert.doesNotMatch(originalSql, /GRANT ALL|UPDATE ON TABLE business\.storage_agent_runtime_receipts|DELETE ON TABLE business\.storage_agent_runtime_receipts/iu);

assert.match(parserProofSql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(parserProofSql, /ADD COLUMN parser_sha256 text COLLATE "C"/u);
assert.match(parserProofSql, /DROP CONSTRAINT storage_agent_runtime_receipts_contracts_check/u);
assert.match(parserProofSql, /jsonb_build_object\('questionPaperExport',3,'storageAgentTransport',2\)[\s\S]*parser_sha256 IS NULL/u);
assert.match(parserProofSql, /jsonb_build_object\('questionPaperExport',3,'storageAgentTransport',3,'questionImportParserProof',1\)[\s\S]*parser_sha256 IS NOT NULL[\s\S]*parser_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/u);
assert.match(parserProofSql, /GRANT SELECT \(parser_sha256\) ON TABLE business\.storage_agent_runtime_receipts TO gewu_cloud_schedule_reader;/u);
assert.doesNotMatch(parserProofSql, /\b(?:UPDATE|DELETE)\s+business\.storage_agent_runtime_receipts\b/iu);
console.log('storage agent runtime receipt SQL checks passed');
