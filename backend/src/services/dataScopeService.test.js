const assert = require('assert');
const { scopeBusinessSnapshot, assertRecordReadable, assertRecordWritable } = require('./dataScopeService');

const snapshot = {
  courses: [
    { id: 'c1', teacher_id: 't1', institution_id: 'i1', room_id: 'r1', student_pricings: JSON.stringify([{ student_id: 's1' }]) },
    { id: 'c2', teacherId: 't2', institutionId: 'i2', roomId: 'r2', student_pricings: [{ studentId: 's1' }, { student_id: 's2' }] },
  ],
  schedules: [
    { id: 'sc1', course_id: 'c1', student_ids: '["s1"]', calculated_teacher_fee: 100, calculated_tuition: 500 },
    { id: 'sc2', courseId: 'c2', studentIds: ['s1', 's2'], calculated_teacher_fee: 900, calculated_tuition: 5000 },
  ],
  students: [{ id: 's1', school_id: 'school1' }, { id: 's2', school_id: 'school2' }],
  enrollments: [{ id: 'e1', schedule_id: 'sc1', student_id: 's1' }, { id: 'e2', schedule_id: 'sc2', student_id: 's2' }],
  consumptions: [{ id: 'x1', schedule_id: 'sc1', student_id: 's1' }, { id: 'x2', schedule_id: 'sc2', student_id: 's2' }],
  payments: [
    { id: 'p-ambiguous', student_id: 's1', amount: 999 },
    { id: 'p1', student_id: 's1', course_id: 'c1', amount: 50 },
    { id: 'p2', student_id: 's2', course_id: 'c2', amount: 500 },
  ],
  institutions: [{ id: 'i1' }, { id: 'i2' }], rooms: [{ id: 'r1' }, { id: 'r2' }], schools: [{ id: 'school1' }, { id: 'school2' }],
  assetRecords: [{ id: 'a1', owner_user_id: 'u1', amount: 10 }, { id: 'a2', owner_user_id: 'u2', amount: 999 }],
  assetCategories: [{ id: 'ac1' }],
  subjects: [{ id: 'sub1' }], questions: [{ id: 'q1' }, { id: 'q2' }], question_assets: [{ id: 'qa1' }],
  revenueStats: { tuition: 999999 }, secretRows: [{ id: 'leak' }], secretObject: { leak: true }, version: 'v1',
};

const scoped = scopeBusinessSnapshot(snapshot, { kind: 'teacher', teacherId: 't1', userId: 'u1' });
assert.deepStrictEqual(scoped.courses.map(x => x.id), ['c1']);
assert.deepStrictEqual(scoped.schedules.map(x => x.id), ['sc1']);
assert.deepStrictEqual(scoped.students.map(x => x.id), ['s1']);
assert.deepStrictEqual(scoped.enrollments.map(x => x.id), ['e1']);
assert.deepStrictEqual(scoped.consumptions.map(x => x.id), ['x1']);
assert.deepStrictEqual(scoped.payments.map(x => x.id), ['p1'], 'student-only payment is ambiguous across teachers and must be denied');
assert.deepStrictEqual(scoped.institutions.map(x => x.id), ['i1']);
assert.deepStrictEqual(scoped.rooms.map(x => x.id), ['r1']);
assert.deepStrictEqual(scoped.schools.map(x => x.id), ['school1']);
assert.deepStrictEqual(scoped.assetRecords.map(x => x.id), ['a1']);
assert.strictEqual(scoped.questions.length, 2, 'public question bank remains complete');
assert.strictEqual(scoped.revenueStats, undefined);
assert.strictEqual(scoped.secretRows, undefined);
assert.strictEqual(scoped.secretObject, undefined);
assert.deepStrictEqual(scoped.scopedFinancials, { tuition: 500, teacherFees: 100, payments: 50, assets: 10 });
assert.strictEqual(scoped.schedules.reduce((sum, row) => sum + row.calculated_teacher_fee, 0), 100, 'teacher totals consume scoped schedules only');
assert.strictEqual(scoped.schedules.reduce((sum, row) => sum + row.calculated_tuition, 0), 500, 'tuition excludes other teachers');
assert.strictEqual(scoped.assetRecords.reduce((sum, row) => sum + row.amount, 0), 10, 'assets exclude other owners');
assert.notStrictEqual(scoped, snapshot);
assert.strictEqual(snapshot.courses.length, 2, 'input must not be mutated');

assert.strictEqual(scopeBusinessSnapshot(snapshot, { kind: 'admin' }).courses.length, 2);
assert.deepStrictEqual(scopeBusinessSnapshot(snapshot, { kind: 'pending' }), {});
const emptyStudent = scopeBusinessSnapshot(snapshot, { kind: 'student', studentIds: [] });
assert.deepStrictEqual(emptyStudent.courses, []);
assert.strictEqual(emptyStudent.questions.length, 2);
assert.strictEqual(emptyStudent.secretRows, undefined);
assert.strictEqual(emptyStudent.revenueStats, undefined);
const studentScoped = scopeBusinessSnapshot({ ...snapshot,
  students: [{ id: 's1', name: 'A', phone: 'secret', balance_money: 999 }],
  courses: [{ ...snapshot.courses[0], price_tuition: 999, notes: 'safe course note' }],
  schedules: [{ ...snapshot.schedules[0], calculated_tuition: 500, student_pricings: [{ student_id: 's1', tuition: 500 }] }],
  teachers: [{ id: 't1', name: 'T', hourly_rate: 999, phone: 'secret' }],
}, { kind: 'student', studentIds: ['s1'], userId: 'u1' });
assert.deepStrictEqual(studentScoped.enrollments.map(x => x.id), ['e1'], 'real enrollment shape links through schedule_id');
assert.strictEqual(studentScoped.students[0].phone, undefined);
assert.strictEqual(studentScoped.students[0].balance_money, undefined);
assert.strictEqual(studentScoped.courses[0].price_tuition, undefined);
assert.strictEqual(studentScoped.schedules[0].calculated_tuition, undefined);
assert.strictEqual(studentScoped.teachers[0].hourly_rate, undefined);
assert.deepStrictEqual(studentScoped.payments, []);
assert.deepStrictEqual(studentScoped.consumptions, []);
assert.deepStrictEqual(studentScoped.assetRecords, []);

assertRecordReadable('courses', snapshot.courses[0], { kind: 'teacher', teacherId: 't1' });
assert.throws(() => assertRecordReadable('courses', snapshot.courses[1], { kind: 'teacher', teacherId: 't1' }), err => err.code === 'TEACHER_SCOPE_VIOLATION');
assert.throws(() => assertRecordReadable('mystery', { id: 'z' }, { kind: 'teacher', teacherId: 't1' }), err => err.code === 'DATA_SCOPE_UNRESOLVED');
assert.throws(() => assertRecordWritable('courses', { teacher_id: 't2' }, { kind: 'teacher', teacherId: 't1' }), err => err.code === 'TEACHER_SCOPE_VIOLATION');
assertRecordWritable('schedules', { course_id: 'c1' }, { kind: 'teacher', teacherId: 't1' }, { courses: snapshot.courses });
assertRecordReadable('payments', { schedule_id: 'sc1' }, { kind: 'teacher', teacherId: 't1' }, { courses: snapshot.courses, schedules: snapshot.schedules });
assertRecordReadable('assetRecords', { owner_user_id: 'u1' }, { kind: 'teacher', teacherId: 't1', userId: 'u1' });
assert.throws(() => assertRecordReadable('payments', { student_id: 's1' }, { kind: 'teacher', teacherId: 't1' }, { courses: snapshot.courses }), err => err.code === 'DATA_SCOPE_UNRESOLVED');
assert.throws(() => assertRecordWritable('schedules', { course_id: 'c2' }, { kind: 'teacher', teacherId: 't1' }, { courses: snapshot.courses }), err => err.code === 'TEACHER_SCOPE_VIOLATION');
assert.throws(() => assertRecordReadable('payments', { course_id: 'c1', schedule_id: 'sc2' }, { kind: 'teacher', teacherId: 't1' }, { courses: snapshot.courses, schedules: snapshot.schedules }), err => err.code === 'TEACHER_SCOPE_VIOLATION');
const hostile = scopeBusinessSnapshot({ ...snapshot,
  questions: [{ id: 'q1', tenant_id: 'secret', created_by: 'secret' }],
  question_contents: [{ id: 'qc1', question_id: 'q1', stem: 'body', answer: 'answer', explanation: 'why', content_hash: 'secret', local_path: 'secret' }],
  question_assets: [{ id: 'qa1', question_id: 'q1', asset_type: 'image', oss_url: 'https://cdn/a.png', data_url: 'data:image/png;base64,AA', mime_type: 'image/png', width: 10, height: 20, alt: 'diagram', oss_key: 'secret', path: 'secret', file_path: 'secret' }],
}, { kind: 'teacher', teacherId: 't1', userId: 'u1' });
assert.strictEqual(hostile.questions[0].tenant_id, undefined);
assert.strictEqual(hostile.question_contents[0].content_hash, undefined);
assert.strictEqual(hostile.question_contents[0].answer, 'answer');
assert.strictEqual(hostile.question_assets[0].oss_key, undefined);
assert.deepStrictEqual(hostile.question_assets[0], { id: 'qa1', question_id: 'q1', asset_type: 'image', oss_url: 'https://cdn/a.png', data_url: 'data:image/png;base64,AA', mime_type: 'image/png', width: 10, height: 20, alt: 'diagram' });
const studentBasics = scopeBusinessSnapshot({
  courses: [{ id: 'c', student_ids: ['s'], room_id: 'r', institution_id: 'i' }], schedules: [],
  students: [{ id: 's', name: 'S', school_id: 'school' }], teachers: [],
  rooms: [{ id: 'r', name: 'Room', display_name: 'Room A', address: 'secret', notes: 'secret' }],
  institutions: [{ id: 'i', name: 'Inst', contact_phone: 'secret', config: '{}' }],
  schools: [{ id: 'school', name: 'School', address: 'secret' }],
}, { kind: 'student', studentIds: ['s'], userId: 'u' });
assert.deepStrictEqual(studentBasics.rooms, [{ id: 'r', name: 'Room', display_name: 'Room A' }]);
assert.deepStrictEqual(studentBasics.institutions, [{ id: 'i', name: 'Inst' }]);
assert.deepStrictEqual(studentBasics.schools, [{ id: 'school', name: 'School' }]);
const finite = require('./dataScopeService').buildScopedFinancialSnapshot({
  schedules: [{ id: 'a', calculated_tuition: '10', calculated_teacher_fee: -2 }, { id: 'a', calculated_tuition: 10 }, { id: 'b', calculated_tuition: 'bad' }, { id: 'c', calculated_tuition: Infinity }],
  payments: [{ id: 'p', amount: '' }, { id: 'p2', amount: -5 }], assetRecords: [],
});
assert.deepStrictEqual(finite, { tuition: 10, teacherFees: -2, payments: -5, assets: 0 });

console.log('dataScopeService tests passed');
