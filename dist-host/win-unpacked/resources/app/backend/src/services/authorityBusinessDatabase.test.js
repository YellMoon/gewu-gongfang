const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseService } = require('../database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-authority-business-db-'));
const dbPath = path.join(workspace, 'authority-copy.db');
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};
let service;
try {
  process.env.DB_PATH = dbPath;
  delete process.env.READ_DB_PATH;
  process.env.NODE_ENV = 'test';
  service = new DatabaseService();
  const options = { tenantId: 'default', authorityCommand: true };

  const student = service.createStudent({
    id: 'student-command-1',
    name: 'Command student',
    balance_money: 0,
    balance_hours: 0,
  }, options);
  assert.strictEqual(student.id, 'student-command-1');

  const course = service.createCourse({
    id: 'course-command-1',
    name: 'Command course',
    display_name: 'Command course',
    type: 1,
    source_type: 1,
    student_pricings: [{ student_id: student.id, tuition: 100 }],
  }, options);
  assert.strictEqual(course.id, 'course-command-1');
  assert.deepStrictEqual(JSON.parse(course.student_pricings), [
    { student_id: student.id, tuition: 100 },
  ]);
  const schedule = service.createSchedule({
    id: 'schedule-command-1',
    course_id: course.id,
    start_time: '2026-07-28T09:00:00.000Z',
    end_time: '2026-07-28T10:00:00.000Z',
    status: 1,
  }, options);
  assert.strictEqual(schedule.id, 'schedule-command-1');

  const payment = service.createPayment({
    id: 'payment-command-1',
    student_id: student.id,
    amount: 100,
    payment_type: 1,
    payment_date: '2026-07-28',
  }, options);
  assert.strictEqual(payment.id, 'payment-command-1');
  assert.strictEqual(service.getStudentById(student.id, options).balance_money, 100);
  service.updatePayment(payment.id, { amount: 125 }, options);
  assert.strictEqual(service.getStudentById(student.id, options).balance_money, 125);
  assert.strictEqual(service.deletePayment(payment.id, options), true);
  assert.strictEqual(service.getStudentById(student.id, options).balance_money, 0);

  const consumption = service.createConsumption({
    id: 'consumption-command-1',
    schedule_id: schedule.id,
    student_id: student.id,
    hours: 2,
    amount: 50,
    consumption_date: '2026-07-28',
  }, options);
  assert.strictEqual(consumption.id, 'consumption-command-1');
  service.updateConsumption(consumption.id, { hours: 3, amount: 75 }, options);
  assert.strictEqual(service.getStudentById(student.id, options).balance_hours, -3);
  assert.strictEqual(service.getStudentById(student.id, options).balance_money, -75);
  assert.strictEqual(service.deleteConsumption(consumption.id, options), true);
  assert.strictEqual(service.getStudentById(student.id, options).balance_hours, 0);
  assert.strictEqual(service.getStudentById(student.id, options).balance_money, 0);

  const grade = service.createGrade({
    id: 'grade-command-1',
    student_id: student.id,
    subject: 'Physics',
    score: 95,
  }, options);
  assert.strictEqual(grade.id, 'grade-command-1');
  assert.strictEqual(service.getGradeById(grade.id, options).score, 95);
  assert.strictEqual(service.deleteGrade(grade.id, options), true);

  console.log('authorityBusinessDatabase tests passed');
} finally {
  if (service) service.close();
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  fs.rmSync(workspace, { recursive: true, force: true });
}
