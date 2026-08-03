const assert = require('assert');
const { projectAuthorityData } = require('./authorityProjectionService');

const fixture = {
  questionPreviews: Array.from({ length: 12 }, (_, index) => ({ id: `q${index + 1}`, stemPreview: `question ${index + 1}`, answer: 'secret' })),
  schedules: [
    { id: 'schedule-s1', studentIds: ['s1', 's2'], studentPricings: { s1: 100, s2: 200 }, teacherId: 't1', calculatedTeacherFee: 50 },
    { id: 'schedule-s2', studentIds: ['s2'], teacherId: 't2' },
  ],
  courses: [
    { id: 'course-t1', studentIds: ['s1'], teacherId: 't1', tuition: 100, lessonPay: 50 },
    { id: 'course-t2', studentIds: ['s2'], teacherId: 't2', tuition: 200, lessonPay: 90 },
  ],
  assets: [
    { id: 'a1', ownerUserId: 'u1', maskedIdentifier: '****1234', accountNumber: '6222123412341234' },
    { id: 'a2', ownerUserId: 'u2', maskedIdentifier: '****2222', accountNumber: '6222000011112222' },
  ],
  students: [
    { id: 's1', name: 'Student 1' },
    { id: 's2', name: 'Student 2' },
  ],
  grades: [
    { id: 'g1', student_id: 's1', score: 95 },
    { id: 'g2', student_id: 's2', score: 88 },
  ],
  payments: [
    { id: 'p1', student_id: 's1', schedule_id: 'schedule-s1', amount: 100 },
    { id: 'p2', student_id: 's2', amount: 999 },
  ],
  consumptions: [
    { id: 'x1', student_id: 's1', schedule_id: 'schedule-s1' },
    { id: 'x2', student_id: 's2', schedule_id: 'schedule-s2' },
  ],
  teachers: [{ id: 't1' }, { id: 't2' }],
  rooms: [{ id: 'room-1' }],
  institutions: [{ id: 'institution-1' }],
  questions: [{ id: 'q-full', answer: 'admin-only' }],
  taxonomySystems: [{ id: 'knowledge' }],
  taxonomyNodes: [{ id: 'node-1', system_id: 'knowledge' }],
  assetRecords: [
    { id: 'ar1', ownerUserId: 'u1', amount: 1 },
    { id: 'ar2', ownerUserId: 'u2', amount: 999 },
  ],
  assetCategories: [
    { id: 'ac1', ownerUserId: 'u1' },
    { id: 'ac2', ownerUserId: 'u2' },
  ],
  roleApplications: [
    {
      applicationId: 'application-1', authorityId: 'authority-1', userId: 'visitor-1',
      requestedRole: 'student', bindingHint: 'student-optional', status: 'pending',
    },
  ],
  roleGrants: [
    {
      bindingId: 'binding-1', authorityId: 'authority-1', userId: 'admin',
      role: 'super_admin', status: 'active', grantVersion: 2,
    },
  ],
};

const visitor = projectAuthorityData({ kind: 'visitor', userId: 'u1' }, fixture);
assert.equal(visitor.questionPreviews.length, 10);
assert.equal(visitor.questionPreviews[0].answer, undefined);
assert.equal(visitor.courses.length, 0);
assert.deepStrictEqual(visitor.assets.map(item => item.id), ['a1'], 'visitor keeps only accounts owned by the current user');
assert.deepStrictEqual(visitor.assetRecords.map(item => item.id), ['ar1'], 'visitor keeps only ledger records owned by the current user');
assert.deepStrictEqual(visitor.assetCategories.map(item => item.id), ['ac1'], 'visitor keeps only categories owned by the current user');
assert.equal(visitor.assets[0].accountNumber, undefined, 'visitor asset payload must never reveal a full account number');
assert.equal(visitor.roleApplications, undefined);
assert.equal(visitor.roleGrants, undefined);

const student = projectAuthorityData({ kind: 'student', userId: 'u1', studentId: 's1' }, fixture);
assert.deepStrictEqual(student.schedules.map(item => item.id), ['schedule-s1']);
assert.equal(student.schedules[0].studentIds, undefined);
assert.equal(student.schedules[0].studentPricings, undefined);
assert.equal(student.schedules[0].calculatedTeacherFee, undefined);
assert.equal(student.courses[0].lessonPay, undefined);
assert.equal(student.courses[0].tuition, 100);
assert.equal(student.assets[0].accountNumber, undefined);
assert.equal(student.assets[0].maskedIdentifier, '****1234');
assert.deepStrictEqual(student.students.map(item => item.id), ['s1']);
assert.deepStrictEqual(student.payments.map(item => item.id), ['p1']);
assert.deepStrictEqual(student.assetRecords.map(item => item.id), ['ar1']);
assert.deepStrictEqual(student.questions, []);

const teacher = projectAuthorityData({ kind: 'teacher', userId: 'u2', teacherId: 't1' }, fixture);
assert.deepStrictEqual(teacher.courses.map(item => item.id), ['course-t1']);
assert.equal(teacher.courses[0].lessonPay, 50);
assert.deepStrictEqual(teacher.students.map(item => item.id), ['s1', 's2']);
assert.deepStrictEqual(teacher.payments.map(item => item.id), ['p1'], 'teacher financial records are limited to bound-course schedules');
assert.deepStrictEqual(teacher.consumptions.map(item => item.id), ['x1']);
assert.deepStrictEqual(teacher.assetCategories.map(item => item.id), ['ac2'], 'teacher must not receive another user\'s asset categories');
assert.deepStrictEqual(
  projectAuthorityData({ kind: 'teacher', userId: 'u2', teacherId: null }, fixture).courses,
  [],
  'an unbound teacher grant is valid but reveals no teacher profile data'
);
assert.deepStrictEqual(
  projectAuthorityData({ kind: 'student', userId: 'u1', studentId: null }, fixture).schedules,
  [],
  'an unbound student grant is valid but reveals no student profile data'
);

const unboundSubjectFixture = {
  questionPreviews: Array.from({ length: 12 }, (_, index) => ({
    id: `unbound-q${index + 1}`,
    stemPreview: `unbound question ${index + 1}`,
    answer: 'must-not-project',
  })),
  schedules: [
    { id: '', studentIds: [''], teacherId: '', courseId: '' },
    { id: null, studentIds: [null], teacherId: null, courseId: null },
    { id: undefined, studentIds: [undefined], teacherId: undefined, courseId: undefined },
  ],
  courses: [
    { id: '', studentIds: [''], teacherId: '' },
    { id: null, studentIds: [null], teacherId: null },
    { id: undefined, studentIds: [undefined], teacherId: undefined },
  ],
  students: [{ id: '' }, { id: null }, { id: undefined }],
  teachers: [{ id: '' }, { id: null }, { id: undefined }],
  grades: [{ studentId: '' }, { studentId: null }, { studentId: undefined }],
  enrollments: [{ studentId: '', scheduleId: '' }, { studentId: null, scheduleId: null }],
  payments: [{ studentId: '', courseId: '', scheduleId: '' }, { studentId: null, courseId: null, scheduleId: null }],
  consumptions: [{ studentId: '', scheduleId: '' }, { studentId: null, scheduleId: null }],
  rooms: [{ id: 'unbound-room' }],
  institutions: [{ id: 'unbound-institution' }],
  schools: [{ id: 'unbound-school' }],
  questions: [{ id: 'unbound-full-question', answer: 'must-not-project' }],
  taxonomySystems: [{ id: 'unbound-taxonomy' }],
  taxonomyNodes: [{ id: 'unbound-taxonomy-node' }],
  assets: [
    { id: 'unbound-own-asset', ownerUserId: 'unbound-user', accountNumber: 'full-secret', maskedIdentifier: '****0001' },
    { id: 'unbound-peer-asset', ownerUserId: 'peer-user', accountNumber: 'peer-secret', maskedIdentifier: '****0002' },
  ],
  assetRecords: [
    { id: 'unbound-own-record', ownerUserId: 'unbound-user' },
    { id: 'unbound-peer-record', ownerUserId: 'peer-user' },
  ],
  assetCategories: [
    { id: 'unbound-own-category', ownerUserId: 'unbound-user' },
    { id: 'unbound-peer-category', ownerUserId: 'peer-user' },
  ],
};
const failClosedBusinessArrays = [
  'schedules', 'courses', 'students', 'teachers', 'grades', 'enrollments',
  'payments', 'consumptions', 'rooms', 'institutions', 'schools', 'questions',
  'taxonomySystems', 'taxonomyNodes',
];
for (const scope of [
  { kind: 'student', userId: 'unbound-user', studentId: null },
  { kind: 'teacher', userId: 'unbound-user', teacherId: undefined },
]) {
  const unbound = projectAuthorityData(scope, unboundSubjectFixture);
  assert.strictEqual(unbound.questionPreviews.length, 10, `${scope.kind} preview access remains capped at ten`);
  assert.strictEqual(unbound.questionPreviews[0].answer, undefined, `${scope.kind} previews remain redacted`);
  assert.deepStrictEqual(unbound.assets.map(row => row.id), ['unbound-own-asset'], `${scope.kind} keeps only its own asset`);
  assert.deepStrictEqual(unbound.assetRecords.map(row => row.id), ['unbound-own-record'], `${scope.kind} keeps only its own asset record`);
  assert.deepStrictEqual(unbound.assetCategories.map(row => row.id), ['unbound-own-category'], `${scope.kind} keeps only its own asset category`);
  assert.strictEqual(unbound.assets[0].accountNumber, undefined, `${scope.kind} asset remains redacted`);
  for (const key of failClosedBusinessArrays) {
    assert.deepStrictEqual(unbound[key], [], `${scope.kind} without a subject binding must fail closed for ${key}`);
  }
  assert.strictEqual(JSON.stringify(unbound).includes('peer-user'), false, `${scope.kind} must not reveal peer asset ownership`);
}

const admin = projectAuthorityData({ kind: 'admin', userId: 'admin', authorityId: 'authority-1' }, fixture);
assert.equal(admin.courses.length, 2);
assert.equal(admin.assets.length, 2);
assert.equal(admin.assets[0].accountNumber, undefined);
assert.deepStrictEqual(admin.questions.map(item => item.id), ['q-full']);
assert.deepStrictEqual(admin.students.map(item => item.id), ['s1', 's2']);
assert.equal(admin.roleApplications, undefined);
assert.equal(admin.roleGrants, undefined);
const superAdmin = projectAuthorityData({
  kind: 'super_admin',
  userId: 'admin',
  authorityId: 'authority-1',
}, fixture);
assert.deepStrictEqual(superAdmin.roleApplications, fixture.roleApplications);
assert.deepStrictEqual(superAdmin.roleGrants, fixture.roleGrants);
assert.equal(JSON.stringify(student).includes('s2'), false, 'student projection must not reveal peer identifiers');

console.log('authorityProjectionService tests passed');
