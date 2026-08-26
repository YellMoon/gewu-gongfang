'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { requireQuestionBankReadAccess } = require('./auth');

function invoke({ method = 'GET', user = null, authz = null } = {}) {
  const response = { statusCode: 200, body: null, nextCalls: 0 };
  const req = { method, user, authz };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; },
  };
  requireQuestionBankReadAccess(req, res, () => { response.nextCalls += 1; });
  return response;
}

const anonymous = invoke();
assert.strictEqual(anonymous.statusCode, 401);
assert.strictEqual(anonymous.body.code, 'UNAUTHORIZED');
assert.strictEqual(anonymous.nextCalls, 0);
for (const role of ['admin', 'operator']) {
  const denied = invoke({ user: { id: `${role}-1`, role }, authz: { role } });
  assert.strictEqual(denied.statusCode, 403, `retired ${role} must not access question-bank data`);
  assert.strictEqual(denied.nextCalls, 0);
}
assert.strictEqual(invoke({ user: { id: 'teacher-1', role: 'teacher' }, authz: { role: 'teacher', teacherId: 'subject-teacher-1' } }).nextCalls, 1);
assert.strictEqual(invoke({ user: { id: 'student-1', role: 'student' }, authz: { role: 'student', studentId: 'subject-student-1' } }).nextCalls, 1);
for (const role of ['visitor', 'student', 'teacher']) {
  const denied = invoke({ user: { id: `${role}-unbound`, role }, authz: { role, studentId: null, teacherId: null } });
  assert.strictEqual(denied.statusCode, 403);
  assert.strictEqual(denied.body.code, 'QUESTION_BANK_SUBJECT_REQUIRED');
  assert.strictEqual(denied.nextCalls, 0);
}
assert.strictEqual(invoke({ method: 'POST', user: { id: 'teacher-1', role: 'teacher' }, authz: { role: 'teacher', teacherId: 'subject-teacher-1' } }).nextCalls, 1);
assert.strictEqual(invoke({ method: 'POST', user: { id: 'operator-1', role: 'operator' }, authz: { role: 'operator' } }).statusCode, 403);
for (const role of ['student', 'teacher']) {
  const deniedWrite = invoke({ method: 'POST', user: { id: `${role}-unbound`, role }, authz: { role } });
  assert.strictEqual(deniedWrite.statusCode, 403, `an unbound ${role} must not bypass the raw question-bank write guard`);
  assert.strictEqual(deniedWrite.body.code, 'QUESTION_BANK_SUBJECT_REQUIRED');
  assert.strictEqual(deniedWrite.nextCalls, 0);
}
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(
  !appSource.includes("app.use('/api/question-bank', optionalAuth, requireQuestionBankReadAccess, requireWriteAccess, questionBankRouter)"),
  'the retired local question-bank router must not remain reachable from the desktop backend',
);

console.log('question bank read access checks passed');
