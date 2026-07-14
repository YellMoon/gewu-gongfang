'use strict';

const REVIEW_DEMO_QUESTIONS = Object.freeze([
  {
    id: 'review-q-1', type: 'choice', status: 'published', difficulty: 'easy',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u4e00\u4e2a\u7269\u4f53\u505a\u5300\u901f\u76f4\u7ebf\u8fd0\u52a8\uff0c\u901f\u5ea6\u4e3a 2 m/s\uff0c5 s \u5185\u7684\u4f4d\u79fb\u662f\u591a\u5c11\uff1f',
    options: ['2 m', '5 m', '10 m', '20 m'], answer: 'C',
    knowledgePoint: '\u5300\u901f\u76f4\u7ebf\u8fd0\u52a8', explanation: '\u6839\u636e s=vt\uff0c\u4f4d\u79fb\u4e3a 10 m\u3002',
  },
  {
    id: 'review-q-2', type: 'fill', status: 'published', difficulty: 'medium',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u8bf7\u5199\u51fa\u725b\u987f\u7b2c\u4e8c\u5b9a\u5f8b\u7684\u6570\u5b66\u8868\u8fbe\u5f0f\u3002',
    answer: 'F = ma', knowledgePoint: '\u725b\u987f\u7b2c\u4e8c\u5b9a\u5f8b', explanation: '\u5408\u5916\u529b\u7b49\u4e8e\u8d28\u91cf\u4e0e\u52a0\u901f\u5ea6\u7684\u4e58\u79ef\u3002',
  },
  {
    id: 'review-q-3', type: 'calculation', status: 'published', difficulty: 'medium',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u8d28\u91cf 2 kg \u7684\u7269\u4f53\u53d7 6 N \u5408\u529b\uff0c\u6c42\u52a0\u901f\u5ea6\u3002',
    answer: '3 m/s^2', knowledgePoint: '\u52a8\u529b\u5b66\u8ba1\u7b97', explanation: '\u7531 a=F/m \u5f97 a=3 m/s^2\u3002',
  },
  {
    id: 'review-q-4', type: 'choice', status: 'published', difficulty: 'easy',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u4e0b\u5217\u54ea\u4e00\u4e2a\u5355\u4f4d\u662f\u529f\u7387\u7684\u5355\u4f4d\uff1f',
    options: ['J', 'N', 'W', 'Pa'], answer: 'C', knowledgePoint: '\u529f\u7387', explanation: '\u529f\u7387\u7684 SI \u5355\u4f4d\u662f\u74e6\u7279 W\u3002',
  },
]);

const BASE = Object.freeze({
  students: [
    { id: 'review-demo-student', name: '\u5ba1\u6838\u793a\u4f8b\u5b66\u751f', school: '\u793a\u4f8b\u4e2d\u5b66', grade_year: 2026, grade_current: '\u9ad8\u4e00', source_type: 'review-demo' },
    { id: 'review-demo-student-2', name: '\u5ba1\u6838\u793a\u4f8b\u5b66\u751f\u4e8c', school: '\u793a\u4f8b\u4e2d\u5b66', grade_year: 2026, grade_current: '\u9ad8\u4e8c', source_type: 'review-demo' },
  ],
  teachers: [{ id: 'review-demo-teacher', name: '\u5ba1\u6838\u793a\u4f8b\u6559\u5e08', subject: '\u7269\u7406' }],
  institutions: [{ id: 'review-demo-institution', name: '\u683c\u7269\u5de5\u574a\u5ba1\u6838\u793a\u4f8b\u6821\u533a' }],
  schools: [{ id: 'review-demo-school', name: '\u793a\u4f8b\u4e2d\u5b66' }],
  rooms: [{ id: 'review-demo-room', name: '\u793a\u4f8b\u6559\u5ba4 A' }],
  courses: [
    { id: 'review-demo-course', name: '\u9ad8\u4e00\u7269\u7406\u793a\u4f8b\u8bfe', display_name: '\u9ad8\u4e00\u7269\u7406', type: 'one-to-one', year: 2026, semester: '\u6691\u671f', teacher_id: 'review-demo-teacher', institution_id: 'review-demo-institution', room_id: 'review-demo-room', student_ids: ['review-demo-student'], active: true },
    { id: 'review-demo-course-2', name: '\u9ad8\u4e8c\u7269\u7406\u793a\u4f8b\u8bfe', display_name: '\u9ad8\u4e8c\u7269\u7406', type: 'small-class', year: 2026, semester: '\u6691\u671f', teacher_id: 'review-demo-teacher', institution_id: 'review-demo-institution', room_id: 'review-demo-room', student_ids: ['review-demo-student-2'], active: true },
  ],
  schedules: [
    { id: 'review-demo-schedule', course_id: 'review-demo-course', start_time: '2026-07-15T10:00:00+08:00', end_time: '2026-07-15T11:30:00+08:00', status: 'scheduled', room_id: 'review-demo-room', student_ids: ['review-demo-student'], calculated_tuition: 240, calculated_teacher_fee: 120 },
    { id: 'review-demo-schedule-2', course_id: 'review-demo-course-2', start_time: '2026-07-16T14:00:00+08:00', end_time: '2026-07-16T15:30:00+08:00', status: 'scheduled', room_id: 'review-demo-room', student_ids: ['review-demo-student-2'], calculated_tuition: 320, calculated_teacher_fee: 160 },
  ],
  enrollments: [{ id: 'review-demo-enrollment', course_id: 'review-demo-course', student_id: 'review-demo-student' }],
  consumptions: [{ id: 'review-demo-consumption', course_id: 'review-demo-course', schedule_id: 'review-demo-schedule', student_id: 'review-demo-student', amount: 240 }],
  payments: [{ id: 'review-demo-payment', student_id: 'review-demo-student', amount: 1200, payment_date: '2026-07-01', source_type: 'review-demo' }],
  assetRecords: [{ id: 'review-demo-asset', name: '\u5ba1\u6838\u793a\u4f8b\u8d44\u4ea7', amount: 5000, category_id: 'review-demo-asset-category' }],
  assetCategories: [{ id: 'review-demo-asset-category', name: '\u6559\u5b66\u8bbe\u5907\u793a\u4f8b' }],
  questions: REVIEW_DEMO_QUESTIONS.map(({ answer, knowledgePoint, explanation, options, ...question }) => ({ ...question })),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildReviewSnapshot(role) {
  const snapshot = clone(BASE);
  if (role !== 'student') return snapshot;
  const studentId = 'review-demo-student';
  const courseIds = new Set(snapshot.courses.filter(item => item.student_ids.includes(studentId)).map(item => item.id));
  return {
    ...snapshot,
    students: snapshot.students.filter(item => item.id === studentId),
    courses: snapshot.courses.filter(item => courseIds.has(item.id)),
    schedules: snapshot.schedules.filter(item => courseIds.has(item.course_id) && item.student_ids.includes(studentId)),
    enrollments: snapshot.enrollments.filter(item => item.student_id === studentId),
    consumptions: [], payments: [], assetRecords: [], assetCategories: [],
  };
}

function buildReviewQuestionPreview(role) {
  const questions = REVIEW_DEMO_QUESTIONS.map(({ answer, knowledgePoint, explanation, options, ...item }) => ({ ...item }));
  return {
    questions: clone(questions),
    sandboxAvailable: true,
    hostAvailable: false,
    targetHostDeviceId: null,
    hostBaseUrl: null,
    reviewDemoRole: role === 'student' ? 'student' : 'admin',
  };
}

function reviewQuestionById(id) {
  const question = REVIEW_DEMO_QUESTIONS.find(item => item.id === String(id));
  return question ? clone(question) : null;
}

module.exports = { REVIEW_DEMO_QUESTIONS, buildReviewQuestionPreview, buildReviewSnapshot, reviewQuestionById };
