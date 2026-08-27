'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260828-question-import-receipt-provisioning.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /GRANT INSERT ON TABLE business\.storage_task_receipts TO gewu_cloud_schedule_reader;/u);
assert.doesNotMatch(sql, /GRANT ALL|UPDATE ON TABLE business\.storage_task_receipts|DELETE ON TABLE business\.storage_task_receipts/iu);

console.log('question import receipt provisioning privilege checks passed');
