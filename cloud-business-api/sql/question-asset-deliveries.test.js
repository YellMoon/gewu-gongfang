'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260827-question-asset-deliveries.sql'), 'utf8');
assert.match(sql, /^BEGIN;/);
assert.ok(sql.includes('CREATE TABLE business.question_asset_deliveries'));
assert.ok(sql.includes('REFERENCES business.question_assets(id)'));
assert.ok(sql.includes("status IN ('queued','leased','ready')"));
assert.ok(sql.includes('asset_bytes bytea'));
assert.ok(sql.includes('expected_sha256'));
assert.ok(sql.includes('REVOKE ALL ON TABLE business.question_asset_deliveries FROM PUBLIC'));
assert.match(sql, /COMMIT;\s*$/);
console.log('question asset delivery schema checks passed');
