'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260901-fixed-super-admin-business-invariant.sql'), 'utf8');
assert.match(sql, /miniapp_cloud_role_grants_one_active_super_admin/u);
assert.match(sql, /role='super_admin' AND status='active'/u);
assert.match(sql, /HAVING count\(\*\)>1/u);
assert.match(sql, /CREATE UNIQUE INDEX/u);
console.log('business fixed super administrator invariant migration checks passed');
