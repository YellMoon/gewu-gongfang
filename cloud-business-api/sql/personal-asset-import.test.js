'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '20260823-personal-asset-import.sql'), 'utf8');
assert.match(source, /CREATE TABLE IF NOT EXISTS business\.personal_asset_imports/, 'cloud must retain an import receipt');
assert.match(source, /CREATE TABLE IF NOT EXISTS business\.personal_asset_categories/, 'cloud must own personal asset categories');
assert.match(source, /CREATE TABLE IF NOT EXISTS business\.personal_asset_records/, 'cloud must own personal asset records');
assert.match(source, /UNIQUE \(tenant_id,account_id,idempotency_key\)/, 'import retries must be idempotent per account');
assert.match(source, /UNIQUE \(import_id,source_ordinal\)/, 'each row must be deduplicated inside its import');
assert.match(source, /REVOKE ALL ON TABLE business\.personal_asset_imports FROM PUBLIC/, 'asset import data must not be publicly readable');
console.log('cloud personal asset import schema checks passed');
