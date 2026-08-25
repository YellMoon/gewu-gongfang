const assert = require('assert');
const fs = require('fs');

const apiSource = fs.readFileSync('miniapp/src/utils/api.ts', 'utf8');
const inventory = fs.readFileSync('miniapp/src/utils/miniappUiPageInventory.js', 'utf8');

assert.ok(!apiSource.includes('export const wechatBindingApi'), 'miniapp API client must not expose the retired binding-review workflow');
assert.strictEqual(fs.existsSync('miniapp/src/pages/admin/users/index.tsx'), false, 'miniapp must not retain the retired administrator account-review page');
assert.ok(!inventory.includes('wechat-binding-read-only') && !inventory.includes('wechat-binding-review'), 'UI inventory must not claim the retired workflow as a real state');

console.log('miniapp retired WeChat binding review UI checks passed');
