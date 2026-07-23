const assert = require('assert');
const fs = require('fs');

const apiSource = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
const adminPage = fs.readFileSync('miniapp/src/pages/admin/users/index.tsx', 'utf8');
const inventory = fs.readFileSync('miniapp/src/utils/miniappUiPageInventory.js', 'utf8');

assert.ok(apiSource.includes('export const wechatBindingApi'), 'API client should expose WeChat binding review operations');
assert.ok(apiSource.includes('/api/miniapp/wechat-bindings/admin?status='), 'binding list must use the protected administrator endpoint');
assert.ok(apiSource.includes('/approve`') && apiSource.includes('/reject`'), 'binding API should cover approve and reject');
assert.ok(adminPage.includes('wechatBindingApi.adminList()'), 'ordinary and super administrators should load the masked binding list');
assert.ok(adminPage.includes('binding.phoneMasked'), 'UI must render only the server-masked phone');
assert.ok(!adminPage.includes('candidateOpenid'), 'UI must not expose candidate openid');
assert.ok(adminPage.includes('canReview &&') && adminPage.includes("reviewBinding(binding, 'approve')"), 'only super-admin review capability should expose approval actions');
assert.ok(adminPage.includes("reviewBinding(binding, 'reject')"), 'super administrator should be able to reject a binding');
assert.ok(inventory.includes('wechat-binding-read-only') && inventory.includes('wechat-binding-review'), 'UI inventory should cover ordinary read-only and super review states');

console.log('miniapp WeChat binding review source checks passed');
