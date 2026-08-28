'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260828-zz-question-import-source-backfill.sql'), 'utf8');

assert.match(sql, /^BEGIN;/);
assert.match(sql, /JOIN business\.question_import_media_objects media/u);
assert.match(sql, /JOIN business\.question_import_tasks task/u);
assert.match(sql, /task\.tenant_id=asset\.tenant_id/u, 'source recovery must not cross tenant boundaries');
assert.match(sql, /HAVING COUNT\(DISTINCT source_file_name\)=1/u, 'only an unambiguous import source may be recovered');
assert.match(sql, /question\.deleted=false/u);
assert.match(sql, /COALESCE\(question\.source,''\)=''/u, 'existing source labels must never be overwritten');
assert.match(sql, /SET source=source\.source_file_name/u);
assert.doesNotMatch(sql, /INSERT INTO business\.questions|DELETE FROM business\.questions|UPDATE business\.question_contents/u,
  'source recovery must not create, delete, or rewrite question text');
assert.match(sql, /COMMIT;\s*$/);

console.log('question import source backfill SQL checks passed');
