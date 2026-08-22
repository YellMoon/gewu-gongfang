'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260822-miniapp-cloud-accounts.sql'), 'utf8');
assert.match(sql, /CREATE TABLE business\.miniapp_cloud_accounts/u);
assert.match(sql, /phone_hmac char\(64\) NOT NULL UNIQUE/u);
assert.match(sql, /CREATE TABLE business\.miniapp_cloud_role_grants/u);
assert.match(sql, /role IN \('super_admin','admin','teacher','student'\)/u);
assert.doesNotMatch(sql, /phone_number|purePhoneNumber|13732250653/u);
console.log('miniapp cloud account SQL checks passed');
