'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-b-business-table-owner-repair.sql'), 'utf8');

assert.match(sql, /^BEGIN;/);
assert.ok(sql.includes('RESET ROLE;'));
assert.ok(sql.includes("c.relkind IN ('r','p')"));
assert.ok(sql.includes("pg_get_userbyid(c.relowner)=current_user"));
assert.ok(sql.includes("ALTER TABLE business.%I OWNER TO vnext_pg17_business_owner"));
assert.match(sql, /COMMIT;\s*$/);
console.log('business table owner repair SQL checks passed');
