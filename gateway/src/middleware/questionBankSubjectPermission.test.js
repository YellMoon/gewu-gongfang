'use strict';

const assert = require('assert');
const { requirePermission } = require('./permission');

function invoke(action, authz) {
  const result = { status: 200, body: null, nextCalls: 0 };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  requirePermission('question-bank', action)({ authz }, res, () => { result.nextCalls += 1; });
  return result;
}

const active = { reviewStatus: 'approved', status: 1, loginEnabled: 1 };
for (const [role, subjectField] of [['student', 'studentId'], ['teacher', 'teacherId']]) {
  const unboundRead = invoke('view', { ...active, role });
  assert.strictEqual(unboundRead.status, 403);
  assert.strictEqual(unboundRead.nextCalls, 0);
  const boundRead = invoke('view', { ...active, role, [subjectField]: `${role}-subject-1` });
  assert.strictEqual(boundRead.nextCalls, 1);
}
assert.strictEqual(invoke('edit', { ...active, role: 'teacher', teacherId: 'teacher-subject-1' }).nextCalls, 1);
assert.strictEqual(invoke('edit', { ...active, role: 'teacher' }).status, 403);
assert.strictEqual(invoke('view', { ...active, role: 'admin' }).status, 403);

console.log('gateway question-bank subject permission checks passed');
