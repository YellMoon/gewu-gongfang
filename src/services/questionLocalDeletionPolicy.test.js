const assert = require('assert');
const { canRemoveQuestionLocalRecord } = require('./questionLocalDeletionPolicy');
assert.strictEqual(canRemoveQuestionLocalRecord({storage_state:'local_draft',sourceDeviceId:'d',ownerUserId:'u'},{deviceId:'d',userId:'u'}),true);
assert.strictEqual(canRemoveQuestionLocalRecord({storage_state:'local_draft',sourceDeviceId:'other',ownerUserId:'u'},{deviceId:'d',userId:'u'}),false);
assert.strictEqual(canRemoveQuestionLocalRecord({storage_state:'local_draft',sourceDeviceId:'d',ownerUserId:'other'},{deviceId:'d',userId:'u'}),false);
assert.strictEqual(canRemoveQuestionLocalRecord({storage_state:'host_committed',sourceDeviceId:'d',ownerUserId:'u'},{deviceId:'d',userId:'u'}),false);
assert.strictEqual(canRemoveQuestionLocalRecord({},{deviceId:'d',userId:'u'}),false);
console.log('question local deletion policy tests passed');
