-- 资产统计模块数据库 Schema
-- SQLite

-- 资产分类表
CREATE TABLE IF NOT EXISTS asset_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  color TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 资产记录表
CREATE TABLE IF NOT EXISTS asset_records (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  student_id TEXT,
  student_name TEXT,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES asset_categories(id)
);

CREATE INDEX IF NOT EXISTS idx_asset_records_date ON asset_records(date);
CREATE INDEX IF NOT EXISTS idx_asset_records_type ON asset_records(type);

INSERT OR IGNORE INTO asset_categories (id, name, type, color) VALUES ('builtin-tuition', '课时费', 'income', '#3f8600');
INSERT OR IGNORE INTO asset_categories (id, name, type, color) VALUES ('builtin-payment', '学费', 'income', '#1890ff');
INSERT OR IGNORE INTO asset_categories (id, name, type, color) VALUES ('builtin-salary', '工资支出', 'expense', '#cf1322');
INSERT OR IGNORE INTO asset_categories (id, name, type, color) VALUES ('builtin-rent', '房租', 'expense', '#fa8c16');
INSERT OR IGNORE INTO asset_categories (id, name, type, color) VALUES ('builtin-material', '教材费', 'expense', '#722ed1');
INSERT OR IGNORE INTO asset_categories (id, name, type, color) VALUES ('builtin-other-income', '其他收入', 'income', '#13c2c2');
INSERT OR IGNORE INTO asset_categories (id, name, type, color) VALUES ('builtin-other-expense', '其他支出', 'expense', '#eb2f96');
