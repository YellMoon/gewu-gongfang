-- 教务管理系统数据库 Schema v3.1
-- 与桌面端 browserDatabase.ts 数据模型一致
-- 软删除 + 同步时间戳支持

-- ===================== 学生表 =====================
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 教室/地址表 =====================
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
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
  tenant_id TEXT DEFAULT 'default',
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

-- ===================== S1-S3 扩展能力：租户、审计、题库拆分、事件、搜索、归档 =====================
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  plan TEXT DEFAULT 'standard',
  archive_before TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  client_id TEXT NOT NULL,
  protocol_version TEXT DEFAULT 'v1-lww',
  action TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  local_updated_at TEXT,
  server_updated_at TEXT,
  resolution TEXT DEFAULT 'lww',
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_devices (
  id TEXT PRIMARY KEY,
  device_name TEXT,
  role TEXT NOT NULL DEFAULT 'desktop-client',
  trusted INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_authorizations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'sync:push',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES sync_devices(id)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  base_version TEXT,
  server_version TEXT,
  client_payload TEXT NOT NULL,
  server_payload TEXT,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS operation_audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  actor TEXT DEFAULT 'system',
  action TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  status TEXT DEFAULT 'success',
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  topic TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  next_attempt_at TEXT,
  locked_at TEXT,
  last_attempt_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,
  grade_level TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  chapter_id TEXT,
  parent_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  subject TEXT DEFAULT '物理',
  subject_id TEXT,
  chapter_id TEXT,
  type TEXT NOT NULL,
  difficulty INTEGER DEFAULT 3,
  source TEXT,
  year TEXT,
  grade TEXT,
  semester TEXT,
  exam_type TEXT DEFAULT '其他',
  region TEXT,
  school TEXT,
  edit_status TEXT DEFAULT '未编辑',
  status TEXT DEFAULT 'draft',
  has_image INTEGER DEFAULT 0,
  has_formula INTEGER DEFAULT 0,
  created_by TEXT DEFAULT '',
  deleted INTEGER DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_contents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
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
  updated_at TEXT NOT NULL
);

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
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_knowledge_points (
  question_id TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  weight REAL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, knowledge_point_id)
);

CREATE TABLE IF NOT EXISTS model_points (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  parent_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_model_points (
  question_id TEXT NOT NULL,
  model_point_id TEXT NOT NULL,
  weight REAL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, model_point_id)
);

CREATE TABLE IF NOT EXISTS knowledge_point_rollups (
  knowledge_point_id TEXT PRIMARY KEY,
  direct_question_count INTEGER DEFAULT 0,
  total_question_count INTEGER DEFAULT 0,
  easy_count INTEGER DEFAULT 0,
  medium_count INTEGER DEFAULT 0,
  hard_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  source_type TEXT NOT NULL,
  file_name TEXT,
  file_hash TEXT,
  status TEXT DEFAULT 'pending',
  total_items INTEGER DEFAULT 0,
  accepted_items INTEGER DEFAULT 0,
  warning_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  duplicate_items INTEGER DEFAULT 0,
  rejected_items INTEGER DEFAULT 0,
  quality_report TEXT,
  result_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  content_hash TEXT,
  question_id TEXT,
  status TEXT DEFAULT 'pending',
  quality_score REAL DEFAULT 0,
  warnings TEXT,
  errors TEXT,
  error_message TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_index_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  error_message TEXT,
  next_attempt_at TEXT,
  locked_at TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS vector_embeddings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_archive_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  job_type TEXT DEFAULT 'archive',
  target_table TEXT NOT NULL,
  archive_before TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  affected_rows INTEGER DEFAULT 0,
  artifact_path TEXT,
  artifact_format TEXT,
  oss_key TEXT,
  oss_url TEXT,
  schedule_cron TEXT,
  retention_days INTEGER DEFAULT 30,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  restored_at TEXT
);

-- ===================== 索引 =====================
CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
CREATE INDEX IF NOT EXISTS idx_students_tenant_deleted ON students(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_students_updated ON students(updated_at);
CREATE INDEX IF NOT EXISTS idx_students_deleted ON students(deleted);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_tenant_deleted ON grades(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_grades_updated ON grades(updated_at);
CREATE INDEX IF NOT EXISTS idx_courses_updated ON courses(updated_at);
CREATE INDEX IF NOT EXISTS idx_courses_tenant_deleted ON courses(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_courses_deleted ON courses(deleted);
CREATE INDEX IF NOT EXISTS idx_schedules_course ON schedules(course_id);
CREATE INDEX IF NOT EXISTS idx_schedules_tenant_deleted ON schedules(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_schedules_time ON schedules(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_schedules_updated ON schedules(updated_at);
CREATE INDEX IF NOT EXISTS idx_schedules_deleted ON schedules(deleted);
CREATE INDEX IF NOT EXISTS idx_enrollments_schedule ON enrollments(schedule_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_tenant_deleted ON enrollments(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_updated ON enrollments(updated_at);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_deleted ON payments(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_payments_updated ON payments(updated_at);
CREATE INDEX IF NOT EXISTS idx_payments_deleted ON payments(deleted);
CREATE INDEX IF NOT EXISTS idx_consumptions_student ON consumptions(student_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_tenant_deleted ON consumptions(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_consumptions_updated ON consumptions(updated_at);
CREATE INDEX IF NOT EXISTS idx_institutions_updated ON institutions(updated_at);
CREATE INDEX IF NOT EXISTS idx_institutions_tenant_deleted ON institutions(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_rooms_updated ON rooms(updated_at);
CREATE INDEX IF NOT EXISTS idx_rooms_tenant_deleted ON rooms(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_teachers_updated ON teachers(updated_at);
CREATE INDEX IF NOT EXISTS idx_teachers_tenant_deleted ON teachers(tenant_id, deleted);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_tenant_name ON schools(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_sync_audit_client ON sync_audit_log(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_audit_record ON sync_audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_sync_devices_last_seen ON sync_devices(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sync_authorizations_device ON sync_authorizations(device_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_operation_audit_created ON operation_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_operation_audit_action ON operation_audit_log(action, status, created_at);
CREATE INDEX IF NOT EXISTS idx_operation_audit_record ON operation_audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_subjects_tenant ON subjects(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id, deleted);
CREATE INDEX IF NOT EXISTS idx_kp_parent ON knowledge_points(parent_id, deleted);
CREATE INDEX IF NOT EXISTS idx_questions_tenant ON questions(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_questions_subject_type ON questions(subject_id, type, difficulty);
CREATE INDEX IF NOT EXISTS idx_question_contents_question ON question_contents(question_id);
CREATE INDEX IF NOT EXISTS idx_question_contents_hash ON question_contents(content_hash);
CREATE INDEX IF NOT EXISTS idx_question_assets_question ON question_assets(question_id);
CREATE INDEX IF NOT EXISTS idx_question_assets_hash ON question_assets(content_hash);
CREATE INDEX IF NOT EXISTS idx_qkp_knowledge ON question_knowledge_points(knowledge_point_id);
CREATE INDEX IF NOT EXISTS idx_model_points_tenant ON model_points(tenant_id, deleted);
CREATE INDEX IF NOT EXISTS idx_model_points_parent ON model_points(parent_id, deleted);
CREATE INDEX IF NOT EXISTS idx_qmp_question ON question_model_points(question_id);
CREATE INDEX IF NOT EXISTS idx_qmp_model ON question_model_points(model_point_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status, created_at);
CREATE INDEX IF NOT EXISTS idx_import_items_batch ON import_items(batch_id, item_index);
CREATE INDEX IF NOT EXISTS idx_search_jobs_status ON search_index_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_vector_entity ON vector_embeddings(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_vector_question_lookup ON vector_embeddings(tenant_id, entity_type, model, updated_at);
CREATE INDEX IF NOT EXISTS idx_archive_jobs_status ON data_archive_jobs(status, created_at);

-- S3 environment/migration baseline. Keep idempotent because schema.sql is still the bootstrap source.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  app_env TEXT NOT NULL DEFAULT 'dev',
  rollback_notes TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations
  (version, name, checksum, applied_at, app_env, rollback_notes)
VALUES
  (3101, 'baseline-single-schema', 'schema.sql', datetime('now'), 'dev',
   'Rollback is snapshot based for the single-file schema: stop service, restore the pre-migration DB backup, then restart with the same APP_ENV/DB_PATH.');
