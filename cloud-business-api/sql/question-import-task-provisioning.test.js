'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260827-question-import-task-provisioning.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /GRANT INSERT ON TABLE business\.storage_object_tasks TO gewu_cloud_schedule_reader;/u);
assert.match(sql, /GRANT INSERT ON TABLE business\.storage_task_receipts TO gewu_cloud_schedule_reader;/u);
assert.doesNotMatch(sql, /GRANT ALL|DELETE ON TABLE business\.storage_object_tasks|UPDATE ON TABLE business\.storage_task_receipts|DELETE ON TABLE business\.storage_task_receipts/iu);

console.log('question import task provisioning privilege checks passed');
