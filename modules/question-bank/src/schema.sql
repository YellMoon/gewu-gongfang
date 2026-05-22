-- 题库管理模块数据库 Schema v4.0
-- 软删除 + ISO 8601 时间戳

-- ===================== 学科表 =====================
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade_level TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 章节表 =====================
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

-- ===================== 知识点表 =====================
CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- ===================== 题目表 =====================
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  subject_id TEXT,
  chapter_id TEXT,
  type TEXT NOT NULL,                     -- single_choice/multiple_choice/true_false/fill_blank/short_answer/computation
  difficulty INTEGER DEFAULT 3,           -- 1-5
  source TEXT,
  status TEXT DEFAULT 'active',
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- ===================== 题干/答案内容拆分 =====================
CREATE TABLE IF NOT EXISTS question_contents (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  stem TEXT NOT NULL,
  answer TEXT,
  explanation TEXT,
  options_json TEXT,
  content_hash TEXT,
  version INTEGER DEFAULT 1,
  oss_key TEXT,
  oss_url TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- ===================== 题目资产 OSS 引用 =====================
CREATE TABLE IF NOT EXISTS question_assets (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER DEFAULT 0,
  oss_key TEXT NOT NULL,
  oss_url TEXT,
  content_hash TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- ===================== 题目知识点多对多关系 =====================
CREATE TABLE IF NOT EXISTS question_knowledge_points (
  question_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  weight REAL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, knowledge_point_id),
  FOREIGN KEY (question_id) REFERENCES questions(id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

-- ===================== 知识树计数上卷缓存 =====================
CREATE TABLE IF NOT EXISTS knowledge_point_rollups (
  knowledge_point_id TEXT PRIMARY KEY,
  direct_question_count INTEGER DEFAULT 0,
  total_question_count INTEGER DEFAULT 0,
  easy_count INTEGER DEFAULT 0,
  medium_count INTEGER DEFAULT 0,
  hard_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

-- ===================== 试卷/题集表 =====================
CREATE TABLE IF NOT EXISTS question_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  subject_id TEXT,
  total_score REAL DEFAULT 0,
  time_limit INTEGER,                    -- 分钟
  created_by TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

-- ===================== 试卷题目关联表 =====================
CREATE TABLE IF NOT EXISTS question_set_items (
  id TEXT PRIMARY KEY,
  question_set_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  score REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (question_set_id) REFERENCES question_sets(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- ===================== 学生做题记录表 =====================
CREATE TABLE IF NOT EXISTS student_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  question_set_id TEXT,
  question_id TEXT NOT NULL,
  student_answer TEXT,
  is_correct INTEGER,                    -- 0:错 1:对 NULL:未批改
  score_earned REAL DEFAULT 0,
  time_spent INTEGER DEFAULT 0,          -- 秒
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (question_set_id) REFERENCES question_sets(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- ===================== 索引 =====================
CREATE INDEX IF NOT EXISTS idx_subjects_deleted ON subjects(deleted);
CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id);
CREATE INDEX IF NOT EXISTS idx_chapters_deleted ON chapters(deleted);
CREATE INDEX IF NOT EXISTS idx_kp_chapter ON knowledge_points(chapter_id);
CREATE INDEX IF NOT EXISTS idx_kp_deleted ON knowledge_points(deleted);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_deleted ON questions(deleted);
CREATE INDEX IF NOT EXISTS idx_question_contents_question ON question_contents(question_id);
CREATE INDEX IF NOT EXISTS idx_question_contents_hash ON question_contents(content_hash);
CREATE INDEX IF NOT EXISTS idx_question_assets_question ON question_assets(question_id);
CREATE INDEX IF NOT EXISTS idx_question_assets_hash ON question_assets(content_hash);
CREATE INDEX IF NOT EXISTS idx_qkp_knowledge ON question_knowledge_points(knowledge_point_id);
CREATE INDEX IF NOT EXISTS idx_qs_subject ON question_sets(subject_id);
CREATE INDEX IF NOT EXISTS idx_qs_deleted ON question_sets(deleted);
CREATE INDEX IF NOT EXISTS idx_qsi_set ON question_set_items(question_set_id);
CREATE INDEX IF NOT EXISTS idx_qsi_question ON question_set_items(question_id);
CREATE INDEX IF NOT EXISTS idx_qsi_deleted ON question_set_items(deleted);
CREATE INDEX IF NOT EXISTS idx_sr_student ON student_records(student_id);
CREATE INDEX IF NOT EXISTS idx_sr_question ON student_records(question_id);
CREATE INDEX IF NOT EXISTS idx_sr_set ON student_records(question_set_id);
CREATE INDEX IF NOT EXISTS idx_sr_deleted ON student_records(deleted);
