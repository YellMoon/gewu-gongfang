'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  checkLoginContract,
  checkRetiredBindingReviewUi,
  containsRemovedReviewClientFlow,
  containsRetiredBindingReviewLoginFlow,
  containsRetiredWechatBindingReviewUi,
  parseProdApiBase,
} = require('./check_miniapp_release');

const source = fs.readFileSync('scripts/check_miniapp_release.js', 'utf8');
const prodSource = fs.readFileSync('miniapp/config/prod.ts', 'utf8');
assert.ok(source.includes('miniapp/dist/app.json'));
assert.ok(source.includes('project.config.json'));
assert.ok(source.includes('urlCheck') && source.includes('uploadWithSourceMap'));
assert.ok(source.includes('wx3d570539bbe6ba1b'));
assert.ok(!source.includes('DEFAULT_REVIEW_API_BASE_URL'));
assert.ok(source.includes('containsRetiredBindingReviewLoginFlow'),
  'release checks must reject the retired binding-review login flow in source and built output');
assert.ok(source.includes('containsRetiredWechatBindingReviewUi'),
  'release checks must reject the retired administrator binding-review UI');
assert.strictEqual(containsRetiredBindingReviewLoginFlow('WECHAT_BINDING_REVIEW_REQUIRED'), true);
assert.strictEqual(containsRetiredBindingReviewLoginFlow("{ kind: 'pending-binding' }"), true);
assert.strictEqual(containsRetiredBindingReviewLoginFlow('PHONE_WECHAT_BINDING_CONFLICT'), false);
assert.doesNotThrow(() => checkLoginContract());
assert.strictEqual(containsRetiredWechatBindingReviewUi('wechatBindingApi.adminList()'), true);
assert.strictEqual(containsRetiredWechatBindingReviewUi('adminApi.getUsers()'), false);
assert.doesNotThrow(() => checkRetiredBindingReviewUi());
assert.strictEqual(containsRemovedReviewClientFlow("identity.token_use === 'review-demo'"), false,
  'legacy-identity rejection markers are security cleanup, not a client login flow');
assert.strictEqual(containsRemovedReviewClientFlow("reviewDemoApi.login('/api/auth/review-demo')"), true);
assert.deepStrictEqual(parseProdApiBase(prodSource), { apiBaseUrl: 'https://physicsedu.xyz/scheduling' });
assert.throws(
  () => parseProdApiBase(prodSource.replaceAll("'https://physicsedu.xyz/scheduling'", "'http://wrong.example.test'")),
  /production miniapp API must use https/,
);
assert.throws(
  () => parseProdApiBase(prodSource.replaceAll("'https://physicsedu.xyz/scheduling'", "'https://wrong.example.test'")),
  /production miniapp API should be https:\/\/physicsedu\.xyz\/scheduling/,
);
assert.throws(
  () => parseProdApiBase(`${prodSource}\n__REVIEW_API_BASE_URL__: JSON.stringify(process.env.REVIEW || 'https://physicsedu.xyz')`),
  /removed review Gateway base/,
);
console.log('miniapp release smoke script checks passed');
