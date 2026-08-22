'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-paper-export-artifact-storage.sql'), 'utf8');
assert.ok(sql.includes('CREATE TABLE business.paper_export_artifacts'));
assert.ok(sql.includes('CREATE TABLE business.encrypted_paper_export_artifact_relays'));
assert.ok(sql.includes('REFERENCES business.paper_export_tasks(task_id)'));
assert.ok(sql.includes('REFERENCES business.storage_object_tasks(task_id)'));
assert.ok(sql.includes("storage_state IN ('queued','verified','failed','revoked')"));
assert.ok(sql.includes('REVOKE ALL ON TABLE business.paper_export_artifacts,business.encrypted_paper_export_artifact_relays FROM PUBLIC'));
console.log('paper export artifact storage SQL checks passed');
