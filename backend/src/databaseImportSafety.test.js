const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DatabaseService } = require('./database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-import-safety-'));
const previousDbPath = process.env.DB_PATH;
const previousReadDbPath = process.env.READ_DB_PATH;
const previousNodeEnv = process.env.NODE_ENV;

process.env.DB_PATH = path.join(workspace, 'scheduling.db');
process.env.READ_DB_PATH = process.env.DB_PATH;
process.env.NODE_ENV = 'production';

try {
  const service = new DatabaseService();
  const imported = service.importAll({
    courses: [{
      id: 'course-1',
      name: '安全导入课程',
      display_name: '安全导入课程',
      type: 1,
      source_type: 1,
      service_type: 2,
      student_pricings: [{ student_id: 'student-1', tuition: 100 }],
      active: true,
      created_at: '2026-06-29T00:00:00.000Z',
      updated_at: '2026-06-29T00:00:00.000Z',
    }],
    schedules: [{
      id: 'schedule-1',
      course_id: 'course-1',
      course_name: '安全导入课程',
      start_time: '2026-06-29 08:00',
      end_time: '2026-06-29 10:00',
      student_ids: ['student-1'],
      student_pricings: [{ student_id: 'student-1', tuition: 100 }],
      status: 1,
      created_at: '2026-06-29T00:00:00.000Z',
      updated_at: '2026-06-29T00:00:00.000Z',
    }],
    institutions: [{
      id: 'institution-1',
      name: '缺少时间戳机构',
      type: 1,
    }],
  }, { tenantId: 'default' });

  assert.strictEqual(imported.imported, true);
  assert.strictEqual(imported.tables.courses, 1);
  assert.strictEqual(imported.tables.schedules, 1);
  assert.strictEqual(imported.tables.institutions, 1);

  const course = service.db.prepare('SELECT * FROM courses WHERE id = ?').get('course-1');
  assert.strictEqual(course.name, '安全导入课程');
  assert.strictEqual(course.active, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(course, 'service_type'));

  const schedule = service.db.prepare('SELECT * FROM schedules WHERE id = ?').get('schedule-1');
  assert.strictEqual(schedule.course_id, 'course-1');
  assert.match(schedule.student_ids, /student-1/);

  const institution = service.db.prepare('SELECT * FROM institutions WHERE id = ?').get('institution-1');
  assert.ok(institution.created_at, 'import should fill missing created_at');
  assert.ok(institution.updated_at, 'import should fill missing updated_at');

  service.close();
  console.log('database import safety checks passed');
} finally {
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  if (previousReadDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previousReadDbPath;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
}
