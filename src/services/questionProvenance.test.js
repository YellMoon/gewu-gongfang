const assert = require('assert');
const { applyTrustedQuestionProvenance } = require('./questionProvenance');
const evil = { content: 'ok', storage_state: 'host_committed', sourceDeviceId: 'evil-device', ownerUserId: 'evil-user' };
assert.deepStrictEqual(applyTrustedQuestionProvenance(evil, { deviceId: 'trusted-device', userId: 'trusted-user' }), { content: 'ok', storage_state: 'local_draft', sourceDeviceId: 'trusted-device', ownerUserId: 'trusted-user' });
assert.deepStrictEqual(applyTrustedQuestionProvenance(evil, {}, { storage_state: 'local_draft', sourceDeviceId: 'original-device', ownerUserId: 'original-user' }), { content: 'ok', storage_state: 'local_draft', sourceDeviceId: 'original-device', ownerUserId: 'original-user' });
console.log('question provenance tests passed');
