'use strict';

const REVIEW_DEMO_QUESTIONS = Object.freeze([
  {
    id: 'review-q-1', type: 'choice', status: 'published', difficulty: 'easy',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u4e00\u4e2a\u7269\u4f53\u505a\u5300\u901f\u76f4\u7ebf\u8fd0\u52a8\uff0c\u901f\u5ea6\u4e3a 2 m/s\uff0c5 s \u5185\u7684\u4f4d\u79fb\u662f\u591a\u5c11\uff1f',
    options: ['2 m', '5 m', '10 m', '20 m'], answer: 'C',
    knowledgePoint: '\u5300\u901f\u76f4\u7ebf\u8fd0\u52a8', explanation: '\u6839\u636e s=vt\uff0c\u4f4d\u79fb\u4e3a 10 m\u3002',
    exportStem: 'A body moves uniformly at 2 m/s. What is its displacement in 5 s?',
    exportKnowledgePoint: 'Uniform linear motion', exportExplanation: 'Using s = vt gives s = 10 m.',
  },
  {
    id: 'review-q-2', type: 'fill', status: 'published', difficulty: 'medium',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u8bf7\u5199\u51fa\u725b\u987f\u7b2c\u4e8c\u5b9a\u5f8b\u7684\u6570\u5b66\u8868\u8fbe\u5f0f\u3002',
    answer: 'F = ma', knowledgePoint: '\u725b\u987f\u7b2c\u4e8c\u5b9a\u5f8b', explanation: '\u5408\u5916\u529b\u7b49\u4e8e\u8d28\u91cf\u4e0e\u52a0\u901f\u5ea6\u7684\u4e58\u79ef\u3002',
    exportStem: "Write Newton's second law as an equation.",
    exportKnowledgePoint: "Newton's second law", exportExplanation: 'Net force equals mass times acceleration.',
  },
  {
    id: 'review-q-3', type: 'calculation', status: 'published', difficulty: 'medium',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u8d28\u91cf 2 kg \u7684\u7269\u4f53\u53d7 6 N \u5408\u529b\uff0c\u6c42\u52a0\u901f\u5ea6\u3002',
    answer: '3 m/s^2', knowledgePoint: '\u52a8\u529b\u5b66\u8ba1\u7b97', explanation: '\u7531 a=F/m \u5f97 a=3 m/s^2\u3002',
    exportStem: 'A 2 kg body experiences a net force of 6 N. Find its acceleration.',
    exportKnowledgePoint: 'Dynamics calculation', exportExplanation: 'Using a = F/m gives a = 3 m/s^2.',
  },
  {
    id: 'review-q-4', type: 'choice', status: 'published', difficulty: 'easy',
    stemPreview: '\u3010\u793a\u4f8b\u3011\u4e0b\u5217\u54ea\u4e00\u4e2a\u5355\u4f4d\u662f\u529f\u7387\u7684\u5355\u4f4d\uff1f',
    options: ['J', 'N', 'W', 'Pa'], answer: 'C', knowledgePoint: '\u529f\u7387', explanation: '\u529f\u7387\u7684 SI \u5355\u4f4d\u662f\u74e6\u7279 W\u3002',
    exportStem: 'Which SI unit measures power?',
    exportKnowledgePoint: 'Power', exportExplanation: 'The SI unit of power is watt, W.',
  },
]);

const EXTERNAL_QUESTION_OMITTED_FIELDS = new Set([
  'answer',
  'knowledgePoint',
  'explanation',
  'options',
  'exportStem',
  'exportKnowledgePoint',
  'exportExplanation',
]);

function externalReviewQuestion(question) {
  return Object.fromEntries(Object.entries(question).filter(([key]) => !EXTERNAL_QUESTION_OMITTED_FIELDS.has(key)));
}

const BASE = Object.freeze({
  students: [
    {
      id: 'review-demo-student', name: '\u5ba1\u6838\u793a\u4f8b\u5b66\u751f', school: '\u793a\u4f8b\u4e2d\u5b66',
      grade_year: 2026, grade_current: '\u9ad8\u4e00', source_type: 1, balance_hours: 12, balance_money: 1200,
      created_at: '2026-07-01T08:00:00.000Z', updated_at: '2026-07-10T08:00:00.000Z',
    },
    {
      id: 'review-demo-student-2', name: '\u5ba1\u6838\u793a\u4f8b\u5b66\u751f\u4e8c', school: '\u793a\u4f8b\u4e2d\u5b66',
      grade_year: 2026, grade_current: '\u9ad8\u4e8c', source_type: 2, institution_id: 'review-demo-institution',
      balance_hours: 8, balance_money: 800, created_at: '2026-07-02T08:00:00.000Z', updated_at: '2026-07-11T08:00:00.000Z',
    },
  ],
  teachers: [{
    id: 'review-demo-teacher', name: '\u5ba1\u6838\u793a\u4f8b\u6559\u5e08', subject: '\u7269\u7406', hourly_rate: 180,
    created_at: '2026-07-01T08:00:00.000Z', updated_at: '2026-07-10T08:00:00.000Z',
  }],
  institutions: [{
    id: 'review-demo-institution', name: '\u683c\u7269\u5de5\u574a\u5ba1\u6838\u793a\u4f8b\u6821\u533a', revenue_share: 0.2,
    created_at: '2026-07-01T08:00:00.000Z',
  }],
  schools: [{
    id: 'review-demo-school', name: '\u793a\u4f8b\u4e2d\u5b66', count: 2,
    created_at: '2026-07-01T08:00:00.000Z', updated_at: '2026-07-10T08:00:00.000Z',
  }],
  rooms: [{
    id: 'review-demo-room', name: '\u793a\u4f8b\u6559\u5ba4 A', address: '\u5ba1\u6838\u793a\u4f8b\u5730\u5740', count: 12,
    created_at: '2026-07-01T08:00:00.000Z', updated_at: '2026-07-10T08:00:00.000Z',
  }],
  courses: [
    {
      id: 'review-demo-course', name: '\u9ad8\u4e00\u7269\u7406\u793a\u4f8b\u8bfe', display_name: '\u9ad8\u4e00\u7269\u7406',
      type: 1, source_type: 1, year: 2026, semester: '\u6691\u671f', teacher_id: 'review-demo-teacher',
      teacher_name: '\u5ba1\u6838\u793a\u4f8b\u6559\u5e08', institution_id: 'review-demo-institution', room_id: 'review-demo-room',
      room_name: '\u793a\u4f8b\u6559\u5ba4 A', price_tuition: 240, price_teacher: 120, billing_unit: 1,
      teacher_fee_mode: 1, student_ids: ['review-demo-student'],
      student_pricings: [{ student_id: 'review-demo-student', tuition: 240, teacher_fee: 120, status: 1 }],
      active: true, default_duration_minutes: 90,
      created_at: '2026-07-01T08:00:00.000Z', updated_at: '2026-07-10T08:00:00.000Z',
    },
    {
      id: 'review-demo-course-2', name: '\u9ad8\u4e8c\u7269\u7406\u793a\u4f8b\u8bfe', display_name: '\u9ad8\u4e8c\u7269\u7406',
      type: 3, source_type: 2, year: 2026, semester: '\u6691\u671f', teacher_id: 'review-demo-teacher',
      teacher_name: '\u5ba1\u6838\u793a\u4f8b\u6559\u5e08', institution_id: 'review-demo-institution', room_id: 'review-demo-room',
      room_name: '\u793a\u4f8b\u6559\u5ba4 A', price_tuition: 320, price_teacher: 160, billing_unit: 1,
      teacher_fee_mode: 2, student_ids: ['review-demo-student-2'],
      student_pricings: [{ student_id: 'review-demo-student-2', tuition: 320, teacher_fee: 160, status: 1 }],
      active: true, default_duration_minutes: 90,
      created_at: '2026-07-02T08:00:00.000Z', updated_at: '2026-07-11T08:00:00.000Z',
    },
  ],
  schedules: [
    {
      id: 'review-demo-schedule', course_id: 'review-demo-course', start_time: '2026-07-15T10:00:00+08:00',
      end_time: '2026-07-15T11:30:00+08:00', status: 1, room_id: 'review-demo-room', room: '\u793a\u4f8b\u6559\u5ba4 A',
      service_type: 1, student_ids: ['review-demo-student'],
      student_pricings: [{ student_id: 'review-demo-student', tuition: 240, teacher_fee: 120, status: 1 }],
      calculated_tuition: 240, calculated_teacher_fee: 120,
      created_at: '2026-07-10T08:00:00.000Z', updated_at: '2026-07-10T08:00:00.000Z',
    },
    {
      id: 'review-demo-schedule-2', course_id: 'review-demo-course-2', start_time: '2026-07-14T14:00:00+08:00',
      end_time: '2026-07-14T15:30:00+08:00', status: 2, room_id: 'review-demo-room', room: '\u793a\u4f8b\u6559\u5ba4 A',
      service_type: 1, student_ids: ['review-demo-student-2'],
      student_pricings: [{ student_id: 'review-demo-student-2', tuition: 320, teacher_fee: 160, status: 1 }],
      calculated_tuition: 320, calculated_teacher_fee: 160,
      created_at: '2026-07-09T08:00:00.000Z', updated_at: '2026-07-14T08:00:00.000Z',
    },
  ],
  enrollments: [
    { id: 'review-demo-enrollment', schedule_id: 'review-demo-schedule', student_id: 'review-demo-student', hours_consumed: 0, status: 1, created_at: '2026-07-10T08:00:00.000Z' },
    { id: 'review-demo-enrollment-2', schedule_id: 'review-demo-schedule-2', student_id: 'review-demo-student-2', hours_consumed: 1.5, status: 2, created_at: '2026-07-09T08:00:00.000Z' },
  ],
  consumptions: [
    {
      id: 'review-demo-consumption', schedule_id: 'review-demo-schedule-2', student_id: 'review-demo-student-2',
      hours: 1.5, amount: 320, consumption_date: '2026-07-14', created_at: '2026-07-14T08:00:00.000Z',
    },
  ],
  payments: [
    {
      id: 'review-demo-payment', student_id: 'review-demo-student', amount: 1200, payment_type: 1,
      payment_date: '2026-07-01', payment_method: '\u5ba1\u6838\u793a\u4f8b', notes: '\u8131\u654f\u793a\u4f8b\u8bb0\u5f55',
      created_at: '2026-07-01T08:00:00.000Z',
    },
  ],
  assetRecords: [{
    id: 'review-demo-asset', name: '\u5ba1\u6838\u793a\u4f8b\u8d44\u4ea7', amount: 5000,
    category_id: 'review-demo-asset-category', type: 'expense', date: '2026-07-01',
    notes: '\u660e\u663e\u865a\u6784\u7684\u5ba1\u6838\u793a\u4f8b', created_at: '2026-07-01T08:00:00.000Z',
  }],
  assetCategories: [{
    id: 'review-demo-asset-category', name: '\u6559\u5b66\u8bbe\u5907\u793a\u4f8b', type: 'expense', color: '#c58a3a',
  }],
  questions: REVIEW_DEMO_QUESTIONS.map(externalReviewQuestion),
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
  const questions = REVIEW_DEMO_QUESTIONS.map(externalReviewQuestion);
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
