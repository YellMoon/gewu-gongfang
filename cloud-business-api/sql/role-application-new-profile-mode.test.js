'use strict';

const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync(__dirname + '/20260826-zzz-role-application-new-profile-mode.sql', 'utf8');

assert.ok(sql.includes("CHECK (profile_mode IN ('existing','new'))"));
assert.ok(sql.includes("p_profile_mode NOT IN ('existing','new')"));
assert.ok(sql.includes("p_requested_identity='family_member' AND p_profile_mode <> 'existing'"));

console.log('role application new-profile mode migration checks passed');
