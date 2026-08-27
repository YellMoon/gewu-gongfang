'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260828-question-import-receipt-writer-provisioning.sql'), 'utf8');

assert.match(sql, /^BEGIN;/m);
assert.match(sql, /GRANT INSERT ON TABLE business\.storage_task_receipts TO vnext_pg17_writer;/);
assert.match(sql, /COMMIT;/);
assert.doesNotMatch(sql, /GRANT ALL|UPDATE|DELETE/);

console.log('question import receipt writer provisioning checks passed');
