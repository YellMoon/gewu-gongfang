'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '20260824-supplemental-business-authority.sql'), 'utf8');
for (const table of ['payments', 'consumptions', 'grades', 'personal_asset_manual_categories', 'personal_asset_manual_records']) {
  assert.match(source, new RegExp(`CREATE TABLE IF NOT EXISTS business\\.${table}`));
  assert.match(source, new RegExp(`REVOKE ALL ON TABLE business\\.${table} FROM PUBLIC`));
}
assert.match(source, /updated_at timestamptz NOT NULL DEFAULT transaction_timestamp\(\)/);
assert.match(source, /deleted boolean NOT NULL DEFAULT false/);
assert.match(source, /GRANT SELECT ON TABLE business\.payments TO gewu_cloud_schedule_reader/);
assert.doesNotMatch(source, /GRANT [^;]*(?:INSERT|UPDATE|DELETE)[^;]* TO gewu_cloud_schedule_reader/);
assert.match(source, /GRANT SELECT,INSERT,UPDATE ON TABLE business\.payments TO vnext_pg17_writer/);
assert.doesNotMatch(source, /GRANT [^;]* ON TABLE business\.payments TO vnext_pg17_runtime/);
console.log('supplemental business authority schema checks passed');
