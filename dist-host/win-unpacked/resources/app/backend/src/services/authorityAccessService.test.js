const assert = require('assert');
const { resolveActingScope } = require('./authorityAccessService');

assert.deepStrictEqual(
  resolveActingScope({ userId: 'u1', actingRole: 'visitor', grants: [] }),
  { kind: 'visitor', userId: 'u1' }
);

assert.throws(
  () => resolveActingScope({ userId: 'u1', actingRole: 'admin', grants: [] }),
  error => error && error.code === 'ACTING_ROLE_NOT_GRANTED'
);

assert.deepStrictEqual(
  resolveActingScope({
    userId: 'u1',
    actingRole: 'student',
    grants: [{ role: 'student', bindingId: 's1', status: 'active', authorityId: 'authority-1' }],
  }),
  { kind: 'student', userId: 'u1', studentId: 's1', authorityId: 'authority-1' }
);

assert.deepStrictEqual(
  resolveActingScope({
    userId: 'u1',
    actingRole: 'teacher',
    grants: [{ role: 'teacher', bindingId: '', status: 'active', authorityId: 'authority-1' }],
  }),
  { kind: 'teacher', userId: 'u1', teacherId: null, authorityId: 'authority-1' }
);

console.log('authorityAccessService tests passed');
