'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260828-storage-agent-receipt-returning-provisioning.sql'), 'utf8');

assert.match(sql, /^BEGIN;/m);
assert.match(sql, /GRANT SELECT \(verified_at\) ON TABLE business\.storage_task_receipts TO gewu_cloud_schedule_reader;/);
assert.match(sql, /COMMIT;/);
assert.doesNotMatch(sql, /GRANT ALL|UPDATE|DELETE|SELECT \*/);

console.log('storage agent receipt RETURNING privilege checks passed');
