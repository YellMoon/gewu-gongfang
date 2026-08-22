'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260822-storage-agent-tasks.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /CREATE TABLE business\.storage_object_tasks/u);
assert.match(sql, /CREATE TABLE business\.storage_task_receipts/u);
assert.match(sql, /state IN \('queued','leased','verified','failed_retryable','quarantined'\)/u);
assert.match(sql, /expected_sha256 text COLLATE "C" NOT NULL CHECK \(expected_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/u);
assert.match(sql, /REVOKE ALL ON TABLE business\.storage_object_tasks, business\.storage_task_receipts FROM PUBLIC/u);
assert.ok(!/nas[_ -]?path|smb:|\\\\/iu.test(sql), 'cloud storage tasks must never carry NAS paths');
assert.ok(!/vnext_control_plane|miniapp_cloud_role_grants|business\.students|business\.teachers/iu.test(sql), 'storage task DDL must not alter identity or teaching tables');

console.log('storage agent task SQL checks passed');
