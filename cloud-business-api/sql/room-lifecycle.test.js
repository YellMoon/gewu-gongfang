'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-zzzz-room-lifecycle.sql'), 'utf8');
assert.match(sql, /vnext_create_room_v1/u);
assert.match(sql, /vnext_update_room_v1/u);
assert.match(sql, /vnext_soft_delete_room/u);
assert.match(sql, /legacy_deleted=true/u);
assert.match(sql, /legacy_room_id/u);
assert.match(sql, /SECURITY DEFINER/u);
console.log('room lifecycle SQL checks passed');
