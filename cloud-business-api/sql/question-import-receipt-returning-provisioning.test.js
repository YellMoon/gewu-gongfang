'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260828-question-import-receipt-returning-provisioning.sql'), 'utf8');

assert.match(sql, /^BEGIN;/m);
assert.match(sql, /GRANT SELECT \(task_id\) ON TABLE business\.storage_task_receipts TO gewu_cloud_schedule_reader;/);
assert.match(sql, /COMMIT;/);
assert.doesNotMatch(sql, /GRANT ALL|UPDATE|DELETE|SELECT \*/);

console.log('question import receipt RETURNING privilege checks passed');
