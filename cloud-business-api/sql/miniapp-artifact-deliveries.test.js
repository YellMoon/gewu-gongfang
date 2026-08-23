'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-miniapp-artifact-deliveries.sql'), 'utf8');

assert.match(sql, /^BEGIN;/);
assert.ok(sql.includes('CREATE TABLE business.miniapp_artifact_deliveries'));
assert.ok(sql.includes("status IN ('queued','leased','ready','failed')"));
assert.ok(sql.includes('artifact_bytes bytea'));
assert.ok(sql.includes('REFERENCES business.paper_export_artifacts(artifact_id)'));
assert.ok(sql.includes('REFERENCES business.paper_export_tasks(task_id)'));
assert.ok(sql.includes('REVOKE ALL ON TABLE business.miniapp_artifact_deliveries FROM PUBLIC'));
assert.match(sql, /COMMIT;\s*$/);
console.log('miniapp artifact delivery schema checks passed');
