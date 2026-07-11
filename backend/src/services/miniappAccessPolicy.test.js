const assert = require('assert');

const {
  filterSnapshotForUser,
  getLinkedStudentIds,
  isAllowedMiniappTaskForUser,
} = require('./miniappAccessPolicy');

const snapshot = {
  id: 'snap-1',
  payload: {
    students: [
      { id: 'stu-1', name: 'Alice', phone: '111', balance_money: 1000, balance_hours: 20, school: 'A' },
      { id: 'stu-2', name: 'Bob', phone: '222', balance_money: 2000, balance_hours: 30, school: 'B' },
    ],
    courses: [
      {
        id: 'course-1',
        name: 'Physics A',
        display_name: 'Physics A',
        teacher_id: 'teacher-1',
        price_tuition: 300,
        price_teacher: 120,
        student_pricings: JSON.stringify([{ student_id: 'stu-1', tuition: 300, teacher_fee: 120 }]),
      },
      {
        id: 'course-2',
        name: 'Physics B',
        display_name: 'Physics B',
        teacher_id: 'teacher-2',
        price_tuition: 500,
        price_teacher: 200,
        student_pricings: JSON.stringify([{ student_id: 'stu-2', tuition: 500, teacher_fee: 200 }]),
      },
    ],
    schedules: [
      {
        id: 'schedule-1',
        course_id: 'course-1',
        student_ids: JSON.stringify(['stu-1']),
        calculated_tuition: 300,
        calculated_teacher_fee: 120,
        student_pricings: JSON.stringify([{ student_id: 'stu-1', tuition: 300, teacher_fee: 120 }]),
      },
      {
        id: 'schedule-2',
        course_id: 'course-2',
        student_ids: JSON.stringify(['stu-2']),
        calculated_tuition: 500,
        calculated_teacher_fee: 200,
        student_pricings: JSON.stringify([{ student_id: 'stu-2', tuition: 500, teacher_fee: 200 }]),
      },
    ],
    teachers: [
      { id: 'teacher-1', name: 'Teacher A', subject: 'physics', phone: '333', hourly_rate: 120 },
      { id: 'teacher-2', name: 'Teacher B', subject: 'physics', phone: '444', hourly_rate: 200 },
    ],
    payments: [{ id: 'pay-1', student_id: 'stu-1', amount: 300 }],
    consumptions: [{ id: 'con-1', student_id: 'stu-1', amount: 300, hours: 2 }],
    assetRecords: [{ id: 'asset-1', amount: 100 }],
    revenueStats: { total: 9999 },
    subjects: [{ id: 'subject-physics', name: '物理' }],
  },
};

const studentUser = {
  id: 'miniapp-user-1',
  user_type: 'student',
  student_id: 'stu-1',
};

assert.deepStrictEqual(getLinkedStudentIds(studentUser), ['stu-1', 'miniapp-user-1']);

const filtered = filterSnapshotForUser(snapshot, studentUser);
assert.strictEqual(filtered.payload.redactedForRole, 'student');
assert.deepStrictEqual(filtered.payload.students.map(item => item.id), ['stu-1']);
assert.deepStrictEqual(filtered.payload.courses.map(item => item.id), ['course-1']);
assert.deepStrictEqual(filtered.payload.schedules.map(item => item.id), ['schedule-1']);
assert.deepStrictEqual(filtered.payload.teachers.map(item => item.id), ['teacher-1']);
assert.deepStrictEqual(filtered.payload.payments, []);
assert.deepStrictEqual(filtered.payload.consumptions, []);
assert.deepStrictEqual(filtered.payload.assetRecords, []);
assert.deepStrictEqual(filtered.payload.revenueStats, undefined);
assert.strictEqual(filtered.payload.subjects.length, 1, 'question-bank snapshot data should remain available');
assert.strictEqual(filtered.payload.students[0].phone, undefined, 'student phone should be redacted');
assert.strictEqual(filtered.payload.students[0].balance_money, undefined, 'student balance money should be redacted');
assert.strictEqual(filtered.payload.courses[0].price_tuition, undefined, 'course tuition should be redacted');
assert.strictEqual(filtered.payload.courses[0].student_pricings, undefined, 'course pricing links should be redacted');
assert.strictEqual(filtered.payload.schedules[0].calculated_tuition, undefined, 'schedule tuition should be redacted');
assert.strictEqual(filtered.payload.schedules[0].student_pricings, undefined, 'schedule pricing should be redacted');
assert.strictEqual(filtered.payload.teachers[0].hourly_rate, undefined, 'teacher rate should be redacted');

const adminSnapshot = filterSnapshotForUser(snapshot, { id: 'admin-1', role: 'admin' });
assert.strictEqual(adminSnapshot.payload.payments.length, 1, 'admin snapshot should keep finance data');
assert.strictEqual(adminSnapshot.payload.courses.length, 2, 'admin snapshot should keep all courses');
const superAdminSnapshot = filterSnapshotForUser(snapshot, { id: 'super-1', role: 'super_admin' });
assert.deepStrictEqual(superAdminSnapshot, adminSnapshot, 'super admin should retain the existing admin snapshot scope');

assert.strictEqual(isAllowedMiniappTaskForUser({ user_type: 'student' }, 'question-paper'), true);
assert.strictEqual(isAllowedMiniappTaskForUser({ user_type: 'student' }, 'asset-import'), false);
assert.strictEqual(isAllowedMiniappTaskForUser({ role: 'admin' }, 'asset-import'), true);
assert.strictEqual(isAllowedMiniappTaskForUser({ role: 'super_admin' }, 'asset-import'), true);
assert.strictEqual(isAllowedMiniappTaskForUser({ role: 'teacher' }, 'asset-import'), false);
assert.strictEqual(isAllowedMiniappTaskForUser(null, 'question-paper'), false);

console.log('miniapp access policy checks passed');
