/**
 * Gateway 数据库初始化
 * 创建用户/权限/邀请等核心表
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'gateway.db');

let db;

function getDb() {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const database = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  database.exec(schema);
  ensureUserColumns(database);
  console.log('[DB] Gateway 数据库表已创建/更新');
  return database;
}

function ensureUserColumns(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  const addColumn = (name, ddl) => {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE users ADD COLUMN ${name} ${ddl}`).run();
      columns.add(name);
    }
  };
  addColumn('login_enabled', 'INTEGER DEFAULT 0');
  addColumn('student_id', 'TEXT');
  addColumn('linked_student_ids', 'TEXT');
  database.prepare('UPDATE users SET login_enabled = 0 WHERE login_enabled IS NULL').run();
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initDatabase, closeDatabase, DB_PATH };
