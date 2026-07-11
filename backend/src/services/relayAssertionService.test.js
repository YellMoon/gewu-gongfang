const assert = require('assert');
const { issueRelayAssertion, verifyRelayAssertion } = require('./relayAssertionService');
const secret = 'test-shared-secret';
const assertion = issueRelayAssertion({ taskId:'task1', actorUserId:'u1', deviceId:'d1', issuedAt:1000, nonce:'n1' }, secret);
assert.deepStrictEqual(verifyRelayAssertion(assertion, secret, { now:2000, maxAgeMs:5000 }),
  { taskId:'task1', actorUserId:'u1', deviceId:'d1', pairingApprovalId:'', issuedAt:1000, nonce:'n1' });
assert.throws(() => verifyRelayAssertion({ ...assertion, actorUserId:'evil' }, secret, { now:2000 }), e => e.code === 'RELAY_ASSERTION_INVALID');
assert.throws(() => verifyRelayAssertion(assertion, secret, { now:10000, maxAgeMs:5000 }), e => e.code === 'RELAY_ASSERTION_EXPIRED');
assert.throws(() => issueRelayAssertion({ taskId:'x' }, ''), e => e.code === 'RELAY_ASSERTION_SECRET_REQUIRED');
console.log('relay assertion service tests passed');
