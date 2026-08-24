'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '20260824-foundation-lifecycle.sql'), 'utf8');
for (const name of ['create_institution_v1', 'update_institution_v1', 'soft_delete_institution', 'create_school_v1', 'update_school_v1', 'soft_delete_school']) {
  assert.match(source, new RegExp(`business\\.vnext_${name}`));
}
assert.match(source, /VNEXT_BUSINESS_INSTITUTION_REFERENCED/);
assert.match(source, /VNEXT_BUSINESS_SCHOOL_REFERENCED/);
assert.match(source, /UPDATE business\.students SET school_legacy=p_name/);
assert.match(source, /session_user <> 'vnext_pg17_writer'/);
console.log('foundation lifecycle SQL checks passed');
