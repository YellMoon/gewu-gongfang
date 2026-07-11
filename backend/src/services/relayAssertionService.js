const crypto = require('crypto');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function canonical(value) { return [value.taskId, value.actorUserId, value.deviceId, value.pairingApprovalId || '', value.issuedAt, value.nonce].join('\n'); }

function issueRelayAssertion(claims, secret) {
  if (!secret) fail('RELAY_ASSERTION_SECRET_REQUIRED');
  const payload = { taskId:claims.taskId, actorUserId:claims.actorUserId, deviceId:claims.deviceId,
    pairingApprovalId:claims.pairingApprovalId || '', issuedAt:Number(claims.issuedAt || Date.now()), nonce:claims.nonce || crypto.randomBytes(18).toString('hex') };
  if (!payload.taskId || !payload.actorUserId || !payload.deviceId) fail('RELAY_ASSERTION_INVALID');
  return { ...payload, signature:crypto.createHmac('sha256', secret).update(canonical(payload)).digest('hex') };
}

function verifyRelayAssertion(assertion, secret, options = {}) {
  if (!secret) fail('RELAY_ASSERTION_SECRET_REQUIRED');
  if (!assertion?.signature) fail('RELAY_ASSERTION_INVALID');
  const expected = crypto.createHmac('sha256', secret).update(canonical(assertion)).digest();
  let supplied;
  try { supplied = Buffer.from(assertion.signature, 'hex'); } catch (_error) { fail('RELAY_ASSERTION_INVALID'); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) fail('RELAY_ASSERTION_INVALID');
  const now = options.now || Date.now();
  if (!Number.isFinite(Number(assertion.issuedAt)) || now - Number(assertion.issuedAt) > (options.maxAgeMs || 5 * 60 * 1000)
    || Number(assertion.issuedAt) > now + 30000) fail('RELAY_ASSERTION_EXPIRED');
  return { taskId:assertion.taskId, actorUserId:assertion.actorUserId, deviceId:assertion.deviceId, pairingApprovalId:assertion.pairingApprovalId || '',
    issuedAt:Number(assertion.issuedAt), nonce:assertion.nonce };
}
module.exports = { issueRelayAssertion, verifyRelayAssertion };
