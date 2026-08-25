'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260822-miniapp-cloud-accounts.sql'), 'utf8');
const retirementSql = fs.readFileSync(path.join(__dirname, '20260826-retire-admin-role.sql'), 'utf8');
assert.match(sql, /CREATE TABLE business\.miniapp_cloud_accounts/u);
assert.match(sql, /phone_hmac char\(64\) NOT NULL UNIQUE/u);
assert.match(sql, /CREATE TABLE business\.miniapp_cloud_role_grants/u);
assert.match(sql, /role IN \('super_admin','teacher','student'\)/u);
assert.doesNotMatch(sql, /'admin'/u);
assert.match(retirementSql, /INSERT INTO business\.miniapp_cloud_role_grant_retirements/u);
assert.match(retirementSql, /DELETE FROM business\.miniapp_cloud_role_grants WHERE role='admin'/u);
assert.match(retirementSql, /role IN \('super_admin','teacher','student'\)/u);
assert.match(sql, /GRANT SELECT,INSERT,UPDATE ON business\.miniapp_cloud_accounts,business\.miniapp_cloud_role_grants TO gewu_cloud_schedule_reader;/u, 'the deployed API runtime role must receive the minimal account-table privileges');
assert.doesNotMatch(sql, /phone_number|purePhoneNumber|13732250653/u);
console.log('miniapp cloud account SQL checks passed');
