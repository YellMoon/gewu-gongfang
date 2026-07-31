const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { DatabaseService } = require('./database');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-tenant-bootstrap-'));
const dbPath = path.join(workspace, 'scheduling.db');
const previous = {
  dbPath: process.env.DB_PATH,
  readDbPath: process.env.READ_DB_PATH,
  nodeEnv: process.env.NODE_ENV,
};

const legacy = new Database(dbPath);
legacy.exec(`
  CREATE TABLE students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    parent_phone TEXT,
    parent_phone_normalized TEXT,
    parent_relation TEXT,
    school TEXT,
    grade_year INTEGER,
    grade_current TEXT,
    source_type INTEGER DEFAULT 1,
    institution_id TEXT,
    is_institution_student INTEGER DEFAULT 0,
    parent_name TEXT,
    parent_wechat TEXT,
    student_source TEXT,
    balance_hours REAL DEFAULT 0,
    balance_money REAL DEFAULT 0,
    notes TEXT,
    deleted INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO students (id, name, deleted, created_at, updated_at)
  VALUES ('legacy-student', '旧数据学生', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`);
legacy.close();

let service;
try {
  process.env.DB_PATH = dbPath;
  delete process.env.READ_DB_PATH;
  process.env.NODE_ENV = 'production';

  service = new DatabaseService();
  const student = service.db.prepare('SELECT tenant_id FROM students WHERE id = ?').get('legacy-student');
  assert.strictEqual(student.tenant_id, 'default');
  console.log('legacy tenant bootstrap test passed');
} finally {
  if (service) service.close();
  if (previous.dbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous.dbPath;
  if (previous.readDbPath === undefined) delete process.env.READ_DB_PATH;
  else process.env.READ_DB_PATH = previous.readDbPath;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous.nodeEnv;
  try {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
  }
}
