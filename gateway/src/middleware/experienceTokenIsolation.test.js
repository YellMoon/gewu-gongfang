'use strict';

const assert = require('assert');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const os = require('os');
const path = require('path');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-experience-token-isolation-'));
process.env.GATEWAY_DB_PATH = path.join(workspace, 'gateway.db');
process.env.JWT_SECRET = 'gateway-experience-isolation-secret-at-least-32-bytes';

const { closeDatabase, getDb, initDatabase } = require('../db/database');
const { authMiddleware, optionalAuth } = require('./auth');

initDatabase();
const now = new Date().toISOString();
getDb().prepare(`INSERT INTO users
  (id, name, user_type, status, login_enabled, review_status, created_at, updated_at)
  VALUES (?, ?, 'student', 1, 1, 'approved', ?, ?)`)
  .run('unrecognized-user', 'Unrecognized User', now, now);

const unrecognizedToken = jwt.sign({
  id: 'unrecognized-user',
  sub: 'unrecognized-user',
  user_type: 'student',
  token_use: 'unrecognized-student',
}, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const reviewToken = jwt.sign({
  id: 'review-demo:student:legacy',
  sub: 'review-demo:student:legacy',
  user_type: 'student',
  token_use: 'review-demo',
}, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

function invoke(middleware, token) {
  let nextCalls = 0;
  const response = { status: 200, body: null };
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {
    status(code) { response.status = code; return this; },
    json(body) { response.body = body; return this; },
  };
  middleware(req, res, () => { nextCalls += 1; });
  return { response, nextCalls };
}

for (const [name, token] of [['review-demo', reviewToken], ['unrecognized-student', unrecognizedToken]]) {
  for (const [middlewareName, middleware] of [['required', authMiddleware], ['optional', optionalAuth]]) {
    const result = invoke(middleware, token);
    assert.strictEqual(result.nextCalls, 0, `${name} token must not pass ${middlewareName} gateway auth`);
    assert.deepStrictEqual(result.response, {
      status: 401,
      body: {
        success: false,
        code: 'EXPERIENCE_TOKEN_NOT_ACCEPTED_BY_GATEWAY',
        error: 'Experience-only tokens are not accepted by the legacy gateway',
      },
    });
  }
}

closeDatabase();
fs.rmSync(workspace, { recursive: true, force: true });
console.log('gateway experience token isolation checks passed');
