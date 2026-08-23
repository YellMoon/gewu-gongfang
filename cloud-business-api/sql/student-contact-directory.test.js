'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-student-contact-directory.sql'), 'utf8');

assert.match(sql, /CREATE TABLE business\.student_contact_directory/u);
assert.match(sql, /contact_slot smallint NOT NULL CHECK \(contact_slot BETWEEN 1 AND 3\)/u);
assert.match(sql, /phone_value text CHECK \(phone_value IS NULL OR phone_value ~ '\^1\[3-9\]\[0-9\]\{9\}\$'\)/u);
assert.match(sql, /phone_hmac char\(64\) CHECK \(phone_hmac IS NULL OR phone_hmac ~ '\^\[0-9a-f\]\{64\}\$'\)/u);
assert.match(sql, /wechat_handle text CHECK \(wechat_handle IS NULL OR \(wechat_handle=btrim\(wechat_handle\) AND wechat_handle<>''\)\)/u);
assert.match(sql, /CHECK \(phone_value IS NOT NULL OR wechat_handle IS NOT NULL\)/u);
assert.match(sql, /UNIQUE \(student_id,contact_slot\)/u);
assert.match(sql, /FOREIGN KEY \(student_id\) REFERENCES business\.students\(id\)/u);
assert.match(sql, /INSERT INTO business\.student_contact_directory[\s\S]*phone_legacy/u);
assert.match(sql, /INSERT INTO business\.student_contact_directory[\s\S]*parent_phone_legacy/u);
assert.match(sql, /INSERT INTO business\.student_contact_directory[\s\S]*parent_wechat_legacy/u);
assert.match(sql, /ON CONFLICT \(student_id,contact_slot\) DO NOTHING/u);
assert.match(sql, /REVOKE ALL ON business\.student_contact_directory FROM PUBLIC;/u);
assert.match(sql, /GRANT SELECT,INSERT,UPDATE ON business\.student_contact_directory TO gewu_cloud_schedule_reader;/u);
assert.doesNotMatch(sql, /wechat_openid|wechat_unionid|password|login_name/iu);

console.log('student contact directory SQL checks passed');
