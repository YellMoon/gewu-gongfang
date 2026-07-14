'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');
const {
  REVIEW_DEMO_AUDIENCE,
  REVIEW_DEMO_ISSUER,
  issueReviewDemoToken,
  parseReviewDemoToken,
  reviewDemoUserFromClaims,
} = require('./reviewDemoSession');

const env = {
  JWT_SECRET: 'review-demo-jwt-secret-that-is-long-enough',
  MINIAPP_REVIEW_EXPERIENCE_CODE: 'review-code-2026-safe',
};

assert.throws(
  () => issueReviewDemoToken({ code: 'wrong', role: 'admin' }, env),
  error => error.code === 'REVIEW_DEMO_CODE_INVALID' && error.statusCode === 403,
);
assert.throws(
  () => issueReviewDemoToken({ code: env.MINIAPP_REVIEW_EXPERIENCE_CODE, role: 'teacher' }, env),
  error => error.code === 'REVIEW_DEMO_ROLE_INVALID' && error.statusCode === 400,
);
assert.throws(
  () => issueReviewDemoToken({ code: 'short', role: 'admin' }, { ...env, MINIAPP_REVIEW_EXPERIENCE_CODE: 'short' }),
  error => error.code === 'REVIEW_DEMO_DISABLED' && error.statusCode === 503,
);

for (const role of ['admin', 'student']) {
  const issued = issueReviewDemoToken({ code: env.MINIAPP_REVIEW_EXPERIENCE_CODE, role }, env);
  assert.strictEqual(issued.role, role);
  assert.strictEqual(issued.user.user_type, role);
  assert.strictEqual(issued.user.is_review_demo, true);
  assert.strictEqual(issued.user.read_only, true);
  assert.strictEqual(issued.user.phone, undefined);
  assert.strictEqual(issued.user.openid, undefined);
  assert.ok(issued.user.review_demo_session_id);
  if (role === 'student') assert.strictEqual(issued.user.student_id, 'review-demo-student');

  const claims = parseReviewDemoToken(issued.token, env);
  assert.strictEqual(claims.token_use, 'review-demo');
  assert.strictEqual(claims.iss, REVIEW_DEMO_ISSUER);
  assert.strictEqual(claims.aud, REVIEW_DEMO_AUDIENCE);
  assert.strictEqual(claims.role, role);
  assert.ok(claims.exp - claims.iat <= 2 * 60 * 60);
  assert.deepStrictEqual(reviewDemoUserFromClaims(claims), issued.user);
}

const normalToken = jwt.sign({ id: 'real-user', user_type: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' });
assert.throws(
  () => parseReviewDemoToken(normalToken, env),
  error => error.code === 'REVIEW_DEMO_TOKEN_INVALID',
);

const wrongAudience = jwt.sign(
  { id: 'review-demo:admin:x', role: 'admin', user_type: 'admin', token_use: 'review-demo', session_id: 'x' },
  env.JWT_SECRET,
  { issuer: REVIEW_DEMO_ISSUER, audience: 'wrong', expiresIn: '2h' },
);
assert.throws(
  () => parseReviewDemoToken(wrongAudience, env),
  error => error.code === 'REVIEW_DEMO_TOKEN_INVALID',
);

console.log('review demo session checks passed');
