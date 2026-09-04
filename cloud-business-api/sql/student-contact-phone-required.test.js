'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260901-student-contact-phone-required.sql'), 'utf8');
assert.match(sql, /student_contact_directory_phone_required/u);
assert.match(sql, /CHECK \(phone_value IS NOT NULL\) NOT VALID/u);
assert.doesNotMatch(sql, /wechat_handle\s+IS\s+NOT\s+NULL/u, 'a display handle must not satisfy the phone requirement');
console.log('student contact phone requirement migration checks passed');
