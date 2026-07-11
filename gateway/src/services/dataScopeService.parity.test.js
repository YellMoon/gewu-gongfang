const assert = require('assert');
const path = require('path');
const backend = require('../../../backend/src/services/dataScopeService');
const gateway = require('./dataScopeService');
const snapshot = { courses: [{ id: 1, teacher_id: 't1', student_ids: '[2]' }], schedules: [{ id: 3, course_id: 1, student_ids: [2], calculated_tuition: '12' }], students: [{ id: 2, name: 'A', phone: 'secret' }], questions: [{ id: 'q', tenant_id: 'secret' }] };
for (const context of [{ kind: 'teacher', teacherId: 't1', userId: 'u' }, { kind: 'student', studentIds: ['2'], userId: 'u' }, { kind: 'pending' }]) assert.deepStrictEqual(gateway.scopeBusinessSnapshot(snapshot, context), backend.scopeBusinessSnapshot(snapshot, context));
assert.ok(!require.resolve('./dataScopeService').includes(`${path.sep}backend${path.sep}`));
console.log('gateway data scope parity checks passed');
