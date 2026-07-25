'use strict';

const assert = require('assert');
const {
  isAllowedUnrecognizedRequest,
  unrecognizedStudentGuard,
} = require('./unrecognizedStudentGuard');

const allowed = [
  ['GET', '/api/auth/me'],
  ['POST', '/api/auth/refresh'],
  ['GET', '/api/miniapp/applications/me'],
  ['POST', '/api/miniapp/applications'],
  ['POST', '/api/miniapp/applications/application-1/withdraw'],
  ['GET', '/api/experience/questions'],
  ['POST', '/api/experience/tasks'],
  ['GET', '/api/experience/tasks/task-1/result'],
  ['POST', '/api/experience/tasks/task-1/cancel'],
  ['GET', '/api/experience/artifacts/artifact-1'],
];

for (const [method, path] of allowed) {
  assert.strictEqual(
    isAllowedUnrecognizedRequest(method, path),
    true,
    `${method} ${path} should remain inside the unrecognized-student whitelist`,
  );
}

const denied = [
  ['GET', '/api/students'],
  ['GET', '/api/courses'],
  ['GET', '/api/teachers'],
  ['GET', '/api/payments'],
  ['GET', '/api/question-bank/questions'],
  ['GET', '/api/cloud/snapshots/read'],
  ['POST', '/api/cloud/tasks'],
  ['POST', '/api/desktop-pairing/request'],
  ['POST', '/api/sync/push'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/permissions/my'],
  ['GET', '/api/auth/desktop-session'],
  ['GET', '/api/miniapp/applications/admin'],
  ['POST', '/api/miniapp/applications/application-1/approve'],
  ['DELETE', '/api/experience/questions'],
  ['GET', '/api/experience-not-really/questions'],
];

for (const [method, path] of denied) {
  assert.strictEqual(
    isAllowedUnrecognizedRequest(method, path),
    false,
    `${method} ${path} must be denied by default`,
  );
}

function invoke(authz, method, path) {
  const response = { statusCode: 200, body: null };
  const req = { authz, method, path };
  const res = {
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };
  let nextCalls = 0;
  unrecognizedStudentGuard(req, res, () => { nextCalls += 1; });
  return { ...response, nextCalls };
}

assert.strictEqual(
  invoke({ tokenUse: 'unrecognized-student' }, 'GET', '/api/auth/me?refresh=1').nextCalls,
  1,
);

assert.deepStrictEqual(
  invoke({ tokenUse: 'unrecognized-student' }, 'GET', '/api/students'),
  {
    statusCode: 403,
    body: {
      success: false,
      code: 'UNRECOGNIZED_SCOPE_FORBIDDEN',
      error: 'Unrecognized student scope does not allow this route',
    },
    nextCalls: 0,
  },
);
assert.strictEqual(
  invoke({ tokenUse: 'unrecognized-student' }, 'GET', '/api/auth/me').nextCalls,
  1,
);
assert.strictEqual(
  invoke({ tokenUse: 'miniapp-session' }, 'GET', '/api/students').nextCalls,
  1,
);
assert.strictEqual(invoke(null, 'GET', '/api/students').nextCalls, 1);

console.log('unrecognized student guard checks passed');
