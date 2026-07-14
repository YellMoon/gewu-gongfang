'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const REVIEW_DEMO_ISSUER = 'gewu-review-demo';
const REVIEW_DEMO_AUDIENCE = 'gewu-miniapp-review';
const REVIEW_DEMO_TOKEN_USE = 'review-demo';
const REVIEW_DEMO_ROLES = new Set(['admin', 'student']);

function reviewDemoError(code, statusCode, message = code) {
  return Object.assign(new Error(message), { code, statusCode });
}

function configFrom(env = process.env) {
  const secret = String(env.JWT_SECRET || '');
  const experienceCode = String(env.MINIAPP_REVIEW_EXPERIENCE_CODE || '').trim();
  if (secret.length < 32 || experienceCode.length < 12) {
    throw reviewDemoError('REVIEW_DEMO_DISABLED', 503, 'review demo is not configured');
  }
  return { secret, experienceCode };
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function codesEqual(candidate, expected) {
  return crypto.timingSafeEqual(digest(candidate), digest(expected));
}

function reviewDemoUserFromClaims(claims = {}) {
  const role = String(claims.role || claims.user_type || '');
  if (!REVIEW_DEMO_ROLES.has(role) || !claims.session_id) {
    throw reviewDemoError('REVIEW_DEMO_TOKEN_INVALID', 401, 'review demo token claims are invalid');
  }
  const user = {
    id: `review-demo:${role}:${claims.session_id}`,
    name: role === 'admin' ? 'Review Demo Administrator' : 'Review Demo Student',
    user_type: role,
    role,
    linked_student_ids: role === 'student' ? ['review-demo-student'] : [],
    review_status: 'approved',
    status: 1,
    login_enabled: 1,
    is_review_demo: true,
    read_only: true,
    review_demo_session_id: String(claims.session_id),
  };
  if (role === 'student') user.student_id = 'review-demo-student';
  return user;
}

function issueReviewDemoToken(input = {}, env = process.env) {
  const { secret, experienceCode } = configFrom(env);
  const role = String(input.role || '').trim();
  if (!REVIEW_DEMO_ROLES.has(role)) {
    throw reviewDemoError('REVIEW_DEMO_ROLE_INVALID', 400, 'review demo role is invalid');
  }
  if (!codesEqual(input.code, experienceCode)) {
    throw reviewDemoError('REVIEW_DEMO_CODE_INVALID', 403, 'review demo code is invalid');
  }
  const sessionId = crypto.randomUUID();
  const claims = {
    id: `review-demo:${role}:${sessionId}`,
    role,
    user_type: role,
    token_use: REVIEW_DEMO_TOKEN_USE,
    session_id: sessionId,
    is_review_demo: true,
    read_only: true,
  };
  const token = jwt.sign(claims, secret, {
    algorithm: 'HS256',
    expiresIn: '2h',
    issuer: REVIEW_DEMO_ISSUER,
    audience: REVIEW_DEMO_AUDIENCE,
    jwtid: sessionId,
  });
  return { token, role, user: reviewDemoUserFromClaims(claims) };
}

function parseReviewDemoToken(token, env = process.env) {
  try {
    const { secret } = configFrom(env);
    const claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: REVIEW_DEMO_ISSUER,
      audience: REVIEW_DEMO_AUDIENCE,
    });
    if (claims.token_use !== REVIEW_DEMO_TOKEN_USE || claims.is_review_demo !== true || claims.read_only !== true) {
      throw new Error('invalid review token use');
    }
    reviewDemoUserFromClaims(claims);
    return claims;
  } catch (error) {
    if (error.code === 'REVIEW_DEMO_DISABLED') throw error;
    throw reviewDemoError('REVIEW_DEMO_TOKEN_INVALID', 401, 'review demo token is invalid');
  }
}

function looksLikeReviewDemoToken(token) {
  try {
    const decoded = jwt.decode(token);
    return decoded?.token_use === REVIEW_DEMO_TOKEN_USE || decoded?.iss === REVIEW_DEMO_ISSUER;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  REVIEW_DEMO_AUDIENCE,
  REVIEW_DEMO_ISSUER,
  REVIEW_DEMO_TOKEN_USE,
  issueReviewDemoToken,
  looksLikeReviewDemoToken,
  parseReviewDemoToken,
  reviewDemoError,
  reviewDemoUserFromClaims,
};
