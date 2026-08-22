const assert = require('assert');
const fs = require('fs');
const { questionDeletePresentation } = require('./questionDeletionPresentation');

assert.deepStrictEqual(questionDeletePresentation({ storage_state:'host_committed' }, { capabilities:['question-bank:delete-committed'] }), { visible:true, enabled:true, reason:'' });
assert.deepStrictEqual(questionDeletePresentation({ storage_state:'host_committed' }, { capabilities:[] }), { visible:false, enabled:false, reason:'已入库试题只能在本地数据主机桌面端删除' });
assert.deepStrictEqual(questionDeletePresentation({ storage_state:'cloud_cached' }), { visible:true, enabled:true, reason:'' });
assert.strictEqual(questionDeletePresentation({ storage_state:'local_draft', sourceDeviceId:'d1', ownerUserId:'u1' }, { deviceId:'d1', userId:'u1' }).enabled, true);
assert.strictEqual(questionDeletePresentation({ storage_state:'local_draft', sourceDeviceId:'d2', ownerUserId:'u1' }, { deviceId:'d1', userId:'u1' }).enabled, false);
const miniappQuestionBank = fs.readFileSync('miniapp/src/pages/question-bank/index.tsx', 'utf8');
assert.ok(!/method\s*:\s*['"]DELETE['"]|deleteQuestion|onDelete/.test(miniappQuestionBank), 'miniapp question bank must not expose deletion');
console.log('question deletion presentation tests passed');
