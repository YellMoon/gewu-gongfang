-- 教务管理系统数据库 Schema v3.1
-- 与桌面端 browserDatabase.ts 数据模型一致
-- 软删除 + 同步时间戳支持

-- ===================== 学生表 =====================
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  school TEXT,
  grade_year INTEGER,
  grade_current TEXT,
  source_type INTEGER DEFAULT 1,        -- 1:自有生源 2:机构生源
  institution_id TEXT,
  parent_name TEXT,
  parent_wechat TEXT,
  student_source TEXT,
  balance_hours REAL DEFAULT 0,
  balance_money REAL DEFAULT 0,
  notes TEXT,
  deleted INTEGER DEFAULT 0,             -- 软删除标记
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 成绩表 =====================
CREATE TABLE IF NOT EXISTS grades (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  score REAL NOT NULL,
  exam_date TEXT,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id)
);

-- ===================== 课程表 =====================
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER,
  semester TEXT,
  display_name TEXT NOT NULL,
  type INTEGER NOT NULL,                 -- 1:一对一 2:一对二 3:小组课 4:大班课
  source_type INTEGER NOT NULL,          -- 1:自有 2:机构 3:混合
  institution_id TEXT,
  price_tuition REAL DEFAULT 0,
  price_teacher REAL DEFAULT 0,
  billing_unit INTEGER DEFAULT 1,        -- 1:按小时 2:按次
  teacher_fee_mode INTEGER DEFAULT 1,    -- 1:按次 2:按学生
  student_pricings TEXT,                 -- JSON: [{student_id, tuition, teacher_fee, status}]
  room_id TEXT,
  room_name TEXT,
  teacher_id TEXT,
  teacher_name TEXT,
  active INTEGER DEFAULT 1,              -- 1:未结课 0:已结课
  default_duration_minutes INTEGER,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 排课表 =====================
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  recurring_rule TEXT,                   -- JSON周期规则
  status INTEGER DEFAULT 1,             -- 1:计划中 2:已完成 3:已取消 4:请假
  room TEXT,
  service_type INTEGER,                 -- 1:中心内 2:上门
  student_ids TEXT,                      -- JSON: ["id1","id2"]
  student_pricings TEXT,                 -- JSON: [{student_id, tuition, teacher_fee}]
  calculated_tuition REAL DEFAULT 0,
  calculated_teacher_fee REAL DEFAULT 0,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- ===================== 选课关联表 =====================
CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  custom_price REAL,
  hours_consumed REAL DEFAULT 0,
  status INTEGER DEFAULT 1,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

-- ===================== 缴费记录表 =====================
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_type INTEGER NOT NULL,         -- 1:学费 2:课时
  payment_date TEXT NOT NULL,
  payment_method TEXT,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id)
);

-- ===================== 课时消耗表 =====================
CREATE TABLE IF NOT EXISTS consumptions (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  hours REAL NOT NULL,
  amount REAL NOT NULL,
  consumption_date TEXT NOT NULL,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

-- ===================== 机构表 =====================
CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  contact_phone TEXT,
  revenue_share REAL,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 学校表（自动收集） =====================
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  count INTEGER DEFAULT 1,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 教室/地址表 =====================
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  count INTEGER DEFAULT 1,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 老师表 =====================
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  hourly_rate REAL,
  notes TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 用户表（微信登录） =====================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wechat_openid TEXT UNIQUE,
  wechat_unionid TEXT,
  nickname TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'admin',
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 同步日志 =====================
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT,
  action TEXT,                           -- pull | push
  table_name TEXT,
  record_id TEXT,
  sync_time TEXT NOT NULL,
  status TEXT                            -- success | conflict | error
);

-- ===================== 索引 =====================
CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
CREATE INDEX IF NOT EXISTS idx_students_updated ON students(updated_at);
CREATE INDEX IF NOT EXISTS idx_students_deleted ON students(deleted);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_updated ON grades(updated_at);
CREATE INDEX IF NOT EXISTS idx_courses_updated ON courses(updated_at);
CREATE INDEX IF NOT EXISTS idx_courses_deleted ON courses(deleted);
CREATE INDEX IF NOT EXISTS idx_schedules_course ON schedules(course_id);
CREATE INDEX IF NOT EXISTS idx_schedules_time ON schedules(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_schedules_updated ON schedules(updated_at);
CREATE INDEX IF NOT EXISTS idx_schedules_deleted ON schedules(deleted);
CREATE INDEX IF NOT EXISTS idx_enrollments_schedule ON enrollments(schedule_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_updated ON enrollments(updated_at);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_updated ON payments(updated_at);
CREATE INDEX IF NOT EXISTS idx_payments_deleted ON payments(deleted);
CREATE INDEX IF NOT EXISTS idx_consumptions_student ON consumptions(student_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_updated ON consumptions(updated_at);
CREATE INDEX IF NOT EXISTS idx_institutions_updated ON institutions(updated_at);
CREATE INDEX IF NOT EXISTS idx_rooms_updated ON rooms(updated_at);
CREATE INDEX IF NOT EXISTS idx_teachers_updated ON teachers(updated_at);
