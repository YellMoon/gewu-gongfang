const assert = require('assert');
const { issueRelayAssertion, verifyRelayAssertion } = require('./relayAssertionService');
const secret = 'test-shared-secret';
const claims = {
  taskId:'task1', actorUserId:'u1', deviceId:'d1', sessionId:'sid-1', activeRole:'teacher', teacherId:'t1',
  authVersion:4, credentialVersion:2, issuedAt:1000, expiresAt:6000, nonce:'n1',
};
const assertion = issueRelayAssertion(claims, secret);
assert.deepStrictEqual(verifyRelayAssertion(assertion, secret, { now:2000, maxAgeMs:5000 }),
  { version:2, ...claims });
assert.throws(() => verifyRelayAssertion({ ...assertion, actorUserId:'evil' }, secret, { now:2000 }), e => e.code === 'RELAY_ASSERTION_INVALID');
assert.throws(() => verifyRelayAssertion(assertion, secret, { now:10000, maxAgeMs:5000 }), e => e.code === 'RELAY_ASSERTION_EXPIRED');
assert.throws(() => issueRelayAssertion({ taskId:'x' }, ''), e => e.code === 'RELAY_ASSERTION_SECRET_REQUIRED');
assert.throws(() => issueRelayAssertion({ ...claims, sessionId:'' }, secret), e => e.code === 'RELAY_ASSERTION_INVALID');
assert.throws(() => issueRelayAssertion({ ...claims, credentialVersion:0 }, secret), e => e.code === 'RELAY_ASSERTION_INVALID');
assert.throws(() => issueRelayAssertion({ ...claims, activeRole:'teacher', teacherId:null }, secret), e => e.code === 'RELAY_ASSERTION_INVALID');
assert.throws(() => issueRelayAssertion({ ...claims, expiresAt:1000 }, secret), e => e.code === 'RELAY_ASSERTION_INVALID');
console.log('relay assertion service tests passed');
