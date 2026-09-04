'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const apiSource = fs.readFileSync(path.join(root, 'src/utils/api.ts'), 'utf8');
const loginSource = fs.readFileSync(path.join(root, 'src/pages/login/index.tsx'), 'utf8');

assert.ok(apiSource.includes("cloudBusinessUrl('/api/desktop/pairing/confirm')"));
assert.ok(apiSource.includes('data: { scene: desktopLogin.scene, loginCode, phoneCode }'));
assert.ok(loginSource.includes('parseDesktopLoginConfirmationQuery'));
assert.ok(loginSource.includes('miniappCloudAuthApi.confirmDesktopLogin'));
assert.ok(loginSource.includes('desktopLogin,'));
assert.ok(loginSource.includes('openType="getPhoneNumber"'));
assert.ok(loginSource.includes("{'\\u786e\\u8ba4\\u767b\\u5f55'}"));
assert.ok(!loginSource.includes('\u6838\u9a8c\u8d26\u53f7'));
assert.ok(!loginSource.includes('\u767b\u8bb0\u8bbe\u5907'));

console.log('desktop login confirmation API source checks passed');
