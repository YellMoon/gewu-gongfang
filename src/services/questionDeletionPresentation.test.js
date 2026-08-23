const assert = require('assert');
const fs = require('fs');
const { questionDeletePresentation } = require('./questionDeletionPresentation');

assert.deepStrictEqual(questionDeletePresentation({ storage_state:'host_committed' }, { capabilities:[] }), { visible:false, enabled:false, reason:'\u5df2\u5165\u5e93\u8bd5\u9898\u53ea\u80fd\u7531\u4e91\u7aef\u6743\u9650\u5141\u8bb8\u7684\u684c\u9762\u7aef\u5220\u9664' });
assert.deepStrictEqual(questionDeletePresentation({ storage_state:'cloud_cached' }), { visible:true, enabled:true, reason:'' });
assert.strictEqual(questionDeletePresentation({ storage_state:'local_draft', sourceDeviceId:'d1', ownerUserId:'u1' }, { deviceId:'d1', userId:'u1' }).enabled, true);
assert.strictEqual(questionDeletePresentation({ storage_state:'local_draft', sourceDeviceId:'d2', ownerUserId:'u1' }, { deviceId:'d1', userId:'u1' }).enabled, false);
const miniappQuestionBank = fs.readFileSync('miniapp/src/pages/question-bank/index.tsx', 'utf8');
assert.ok(!/method\s*:\s*['"]DELETE['"]|deleteQuestion|onDelete/.test(miniappQuestionBank), 'miniapp question bank must not expose deletion');
console.log('question deletion presentation tests passed');
