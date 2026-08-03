'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const previousSecret = process.env.JWT_SECRET;
const secret = 'backend-review-isolation-test-secret-at-least-32-bytes';
process.env.JWT_SECRET = secret;

try {
  const { authMiddleware, optionalAuth } = require('./auth');
  const token = jwt.sign(
    {
      id: 'review-demo:admin:session-a',
      role: 'admin',
      user_type: 'admin',
      token_use: 'review-demo',
      session_id: 'session-a',
    },
    secret,
    { algorithm: 'HS256', issuer: 'gewu-review-demo', audience: 'gewu-miniapp-review', expiresIn: '2h' },
  );

  function responseRecorder() {
    return {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
  }

  const protectedReq = { headers: { authorization: `Bearer ${token}` } };
  const protectedRes = responseRecorder();
  let protectedNext = false;
  authMiddleware(protectedReq, protectedRes, () => { protectedNext = true; });
  assert.strictEqual(protectedNext, false);
  assert.strictEqual(protectedRes.statusCode, 401);
  assert.strictEqual(protectedRes.body.code, 'TOKEN_INVALID', 'Backend must reject Gateway review tokens by token type before persisted-user lookup');

  const optionalReq = { headers: { authorization: `Bearer ${token}` } };
  const optionalRes = responseRecorder();
  let optionalNext = false;
  optionalAuth(optionalReq, optionalRes, () => { optionalNext = true; });
  assert.strictEqual(optionalNext, false, 'a valid Gateway review token must fail closed instead of degrading to anonymous Backend access');
  assert.strictEqual(optionalRes.statusCode, 401);
  assert.strictEqual(optionalRes.body.code, 'TOKEN_INVALID');
  assert.strictEqual(optionalReq.user, undefined);
  assert.strictEqual(optionalReq.authz, undefined);

  const localBridgeReq = {
    method: 'POST',
    originalUrl: '/api/desktop-identity/primary-host/local-evidence',
    headers: {
      authorization: `Bearer ${token}`,
      'x-gewu-electron-local-bridge': 'nonempty-bridge-proof',
    },
  };
  const localBridgeRes = responseRecorder();
  let localBridgeNext = false;
  optionalAuth(localBridgeReq, localBridgeRes, () => { localBridgeNext = true; });
  assert.strictEqual(localBridgeNext, true,
    'the Electron-only local evidence route must reach its own loopback/secret verifier even with a cloud desktop JWT');
  assert.strictEqual(localBridgeRes.statusCode, null);

  const unbridgedEvidenceReq = {
    method: 'POST',
    originalUrl: '/api/desktop-identity/primary-host/local-evidence',
    headers: { authorization: `Bearer ${token}` },
  };
  const unbridgedEvidenceRes = responseRecorder();
  let unbridgedEvidenceNext = false;
  optionalAuth(unbridgedEvidenceReq, unbridgedEvidenceRes, () => { unbridgedEvidenceNext = true; });
  assert.strictEqual(unbridgedEvidenceNext, false);
  assert.strictEqual(unbridgedEvidenceRes.body.code, 'TOKEN_INVALID');

  console.log('backend review token isolation checks passed');
} finally {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
}
