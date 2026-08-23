'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-a-paper-export-artifact-owner-repair.sql'), 'utf8');

assert.match(sql, /^BEGIN;/);
assert.ok(sql.includes('RESET ROLE;'));
assert.ok(sql.includes('ALTER TABLE IF EXISTS business.paper_export_artifacts OWNER TO vnext_pg17_business_owner;'));
assert.ok(sql.includes('ALTER TABLE IF EXISTS business.encrypted_paper_export_artifact_relays OWNER TO vnext_pg17_business_owner;'));
assert.match(sql, /COMMIT;\s*$/);
console.log('paper export artifact owner repair SQL checks passed');
