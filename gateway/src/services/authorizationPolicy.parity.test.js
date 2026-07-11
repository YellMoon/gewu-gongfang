const assert = require('assert');
const backend = require('../../../backend/src/services/authorizationPolicy');
const gateway = require('./authorizationPolicy');

const cases = [
  [{ phone: '' }, [], { ok: false, code: 'TEACHER_NOT_FOUND' }],
  [{ phone: '138 0000 0001' }, [{ id: 'deleted', phone: '13800000001', deleted: 1 }], { ok: false, code: 'TEACHER_NOT_FOUND' }],
  [{ phone: '13800000002' }, [{ id: 'one', phone: '138-0000-0002', deleted: 0 }], { ok: true, teacherId: 'one' }],
  [{ phone: '13800000003' }, [{ id: 'a', phone: '138-0000-0003', deleted: 0 }, { id: 'b', phone: '13800000003', deleted: false }], { ok: false, code: 'TEACHER_PHONE_NOT_UNIQUE' }],
];
for (const [user, teachers, expected] of cases) {
  assert.deepStrictEqual(gateway.resolveTeacherBinding(user, teachers), expected);
  assert.deepStrictEqual(gateway.resolveTeacherBinding(user, teachers), backend.resolveTeacherBinding(user, teachers));
}
console.log('gateway/backend authorization policy parity tests passed');
