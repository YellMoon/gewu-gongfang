-- 教务管理系统数据库 Schema v3.1
-- 与桌面端 browserDatabase.ts 数据模型一致
-- 软删除 + 同步时间戳支持

-- ===================== 学生表 =====================
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,
  phone TEXT,
  parent_phone TEXT,
  parent_phone_normalized TEXT,
  parent_relation TEXT,
  school TEXT,
  grade_year INTEGER,
  grade_current TEXT,
  source_type INTEGER DEFAULT 1,        -- 1:自有生源 2:机构生源
  institution_id TEXT,
  is_institution_student INTEGER DEFAULT 0,
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
  phone TEXT,
  name TEXT,
  nickname TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'admin',
  status INTEGER DEFAULT 1,
  login_enabled INTEGER DEFAULT 0,
  identity_kind TEXT,
  auth_version INTEGER NOT NULL DEFAULT 1,
  disabled_at TEXT,
  student_id TEXT,
  linked_student_ids TEXT,
  teacher_id TEXT,
  review_status TEXT DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  is_super_admin_identity INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_role_grants (
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'teacher', 'student')),
  subject_type TEXT,
  subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  source TEXT NOT NULL,
  granted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (
    (role = 'teacher' AND subject_type = 'teacher' AND subject_id IS NOT NULL)
    OR (role = 'student' AND subject_type = 'student' AND subject_id IS NOT NULL)
    OR (role IN ('super_admin', 'admin') AND subject_type IS NULL AND subject_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_role_grants_active_teacher
  ON user_role_grants(subject_id)
  WHERE role = 'teacher' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_role_grants_user_status
  ON user_role_grants(user_id, status, role);

-- Runtime architecture reset: additive authority records. Legacy users.role is compatibility-only.
CREATE TABLE IF NOT EXISTS authority_accounts (
  user_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS authority_role_bindings (
  binding_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'super_admin')),
  subject_type TEXT,
  subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'pending')),
  grant_version INTEGER NOT NULL DEFAULT 1,
  granted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (
    (role IN ('student', 'teacher') AND (
      (subject_type IS NULL AND subject_id IS NULL)
      OR (subject_type = role AND subject_id IS NOT NULL)
    ))
    OR (role IN ('admin', 'super_admin') AND subject_type IS NULL AND subject_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_authority_role_bindings_user
  ON authority_role_bindings(authority_id, user_id, role, status);

CREATE TABLE IF NOT EXISTS authority_role_applications (
  application_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('student', 'teacher')),
  binding_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_authority_role_applications_pending
  ON authority_role_applications(authority_id, user_id, requested_role)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_authority_role_bindings_active
  ON authority_role_bindings(authority_id, user_id, role)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS asset_accounts (
  account_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('saving_card', 'credit_card', 'alipay', 'wechat', 'custom')),
  provider TEXT,
  label TEXT NOT NULL,
  masked_identifier TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_asset_accounts_owner
  ON asset_accounts(authority_id, owner_user_id, status);

CREATE TABLE IF NOT EXISTS personal_asset_categories (
  category_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category_type TEXT NOT NULL CHECK (category_type IN ('income', 'expense')),
  color TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_personal_asset_categories_owner
  ON personal_asset_categories(authority_id, owner_user_id, status);

CREATE TABLE IF NOT EXISTS personal_asset_records (
  record_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  record_date TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('income', 'expense')),
  category_id TEXT,
  category_name TEXT,
  amount REAL NOT NULL,
  student_id TEXT,
  student_name TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  FOREIGN KEY (account_id) REFERENCES asset_accounts(account_id),
  FOREIGN KEY (category_id) REFERENCES personal_asset_categories(category_id)
);

CREATE INDEX IF NOT EXISTS idx_personal_asset_records_owner
  ON personal_asset_records(authority_id, owner_user_id, status, record_date);

CREATE TABLE IF NOT EXISTS authority_migration_ledger (
  name TEXT PRIMARY KEY,
  source_fingerprint TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  report_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_grants (
  grant_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  host_generation INTEGER NOT NULL CHECK (host_generation >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  grant_version INTEGER NOT NULL DEFAULT 1 CHECK (grant_version >= 1),
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(authority_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS device_leases (
  lease_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active_role TEXT NOT NULL
    CHECK (active_role IN ('visitor', 'student', 'teacher', 'admin', 'super_admin')),
  grant_version INTEGER NOT NULL CHECK (grant_version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (grant_id) REFERENCES device_grants(grant_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_device_leases_active
  ON device_leases(authority_id, device_id, user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS host_commands (
  command_id TEXT PRIMARY KEY,
  target_host_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'completed', 'rejected')),
  claim_token TEXT,
  claim_until TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(actor_user_id, device_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_host_commands_claimable
  ON host_commands(target_host_id, status, claim_until, created_at);

CREATE TABLE IF NOT EXISTS host_receipts (
  command_id TEXT PRIMARY KEY,
  result_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (command_id) REFERENCES host_commands(command_id)
);

CREATE TABLE IF NOT EXISTS authority_command_ledger (
  command_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  host_epoch_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('committed', 'rejected')),
  result_hash TEXT,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  UNIQUE(actor_user_id, device_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS authority_command_receipts (
  command_id TEXT PRIMARY KEY,
  result_hash TEXT NOT NULL,
  result_payload TEXT NOT NULL,
  projection_version INTEGER NOT NULL DEFAULT 0 CHECK (projection_version >= 0),
  completed_at TEXT NOT NULL,
  FOREIGN KEY (command_id) REFERENCES authority_command_ledger(command_id)
);

CREATE TABLE IF NOT EXISTS authority_projection_versions (
  authority_id TEXT NOT NULL,
  host_epoch_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (authority_id, host_epoch_id)
);

CREATE TABLE IF NOT EXISTS authority_scoped_projections (
  authority_id TEXT NOT NULL,
  host_epoch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('visitor', 'student', 'teacher', 'admin', 'super_admin')),
  source_version INTEGER NOT NULL CHECK (source_version >= 0),
  payload_hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (authority_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_authority_scoped_projections_epoch_version
  ON authority_scoped_projections(authority_id, host_epoch_id, source_version);

CREATE INDEX IF NOT EXISTS idx_authority_command_ledger_host
  ON authority_command_ledger(authority_id, host_epoch_id, status, created_at);

CREATE TABLE IF NOT EXISTS authorization_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_phone TEXT,
  target_user_id TEXT,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_rejections (
  id TEXT PRIMARY KEY,
  operation_id TEXT,
  actor_user_id TEXT,
  actor_teacher_id TEXT,
  source_device_id TEXT,
  table_name TEXT,
  record_id TEXT,
  reason_code TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorization_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS miniapp_login_attempts (
  id TEXT PRIMARY KEY,
  wechat_openid TEXT NOT NULL,
  wechat_unionid TEXT,
  nickname TEXT,
  avatar_url TEXT,
  denial_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS miniapp_login_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  phone_normalized TEXT NOT NULL,
  identity_kind TEXT,
  result_code TEXT NOT NULL,
  session_id TEXT,
  miniapp_version TEXT,
  platform TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS miniapp_role_applications (
  id TEXT PRIMARY KEY,
  applicant_user_id TEXT NOT NULL,
  application_type TEXT NOT NULL CHECK(application_type IN ('student', 'teacher')),
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  verified_phone_normalized TEXT NOT NULL,
  student_phone_normalized TEXT,
  parent_phone_normalized TEXT,
  applicant_identity_kind TEXT,
  host_task_id TEXT,
  host_entity_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  rejection_reason TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS miniapp_wechat_binding_requests (
  id TEXT PRIMARY KEY,
  target_user_id TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  candidate_openid TEXT NOT NULL,
  candidate_unionid TEXT,
  status TEXT NOT NULL CHECK(status IN ('submitted', 'approved', 'rejected', 'expired')),
  revision INTEGER NOT NULL DEFAULT 1,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (target_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS account_memberships (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS identity_provisioning_receipts (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(application_id, revision, request_hash)
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
  owner_user_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_delivery_scope (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  actor_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  last_visible_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, actor_user_id, device_id, table_name, record_id)
);

CREATE TABLE IF NOT EXISTS relay_authorization_nonces (
  nonce TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS desktop_device_authorizations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  device_kind TEXT NOT NULL DEFAULT 'desktop-client'
    CHECK (device_kind IN ('desktop-client', 'primary-host')),
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'revoked', 'replaced', 'retired')),
  source_challenge_id TEXT NOT NULL UNIQUE,
  authorization_source TEXT NOT NULL DEFAULT 'wechat_phone'
    CHECK (authorization_source = 'wechat_phone'),
  approved_by_user_id TEXT,
  approved_by_device_id TEXT,
  approved_at TEXT,
  last_phone_verified_at TEXT NOT NULL,
  phone_reverify_due_at TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  last_seen_at TEXT,
  replaced_by_device_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  retired_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS desktop_identity_challenges (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  device_kind TEXT NOT NULL DEFAULT 'desktop-client'
    CHECK (device_kind IN ('desktop-client', 'primary-host')),
  public_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  purpose TEXT NOT NULL,
  challenge_token_hash TEXT NOT NULL UNIQUE,
  short_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_phone'
    CHECK (status IN (
      'pending_phone', 'identity_verified_pending_approval', 'approved_pending_exchange',
      'exchanged', 'expired', 'rejected', 'conflict', 'cancelled'
    )),
  claimed_user_id TEXT,
  verified_login_event_id TEXT UNIQUE,
  authorization_id TEXT,
  phone_verified_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  exchanged_at TEXT,
  rejected_at TEXT,
  cancelled_at TEXT,
  FOREIGN KEY (claimed_user_id) REFERENCES users(id),
  FOREIGN KEY (verified_login_event_id) REFERENCES miniapp_login_events(id) ON DELETE SET NULL,
  FOREIGN KEY (authorization_id) REFERENCES desktop_device_authorizations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_identity_active_short_code
  ON desktop_identity_challenges(short_code)
  WHERE status IN ('pending_phone', 'identity_verified_pending_approval', 'approved_pending_exchange');

CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_identity_active_device
  ON desktop_identity_challenges(device_id)
  WHERE status IN ('pending_phone', 'identity_verified_pending_approval', 'approved_pending_exchange');

CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_identity_active_key_fingerprint
  ON desktop_identity_challenges(key_fingerprint)
  WHERE status IN ('pending_phone', 'identity_verified_pending_approval', 'approved_pending_exchange');

CREATE INDEX IF NOT EXISTS idx_desktop_identity_claimant_status
  ON desktop_identity_challenges(claimed_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_desktop_device_authorizations_user_status
  ON desktop_device_authorizations(user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS desktop_device_activations (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  authorization_id TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  package_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('activation_pending', 'active', 'expired', 'cancelled')),
  expires_at TEXT NOT NULL,
  finalized_at TEXT,
  receipt_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES desktop_identity_challenges(id),
  FOREIGN KEY (authorization_id) REFERENCES desktop_device_authorizations(id)
);

CREATE INDEX IF NOT EXISTS idx_desktop_device_activations_authorization_status
  ON desktop_device_activations(authorization_id, status, updated_at);

CREATE TABLE IF NOT EXISTS desktop_sync_batch_backups (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  request_id TEXT,
  source_device_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  change_digest TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  sqlite_backup_path TEXT NOT NULL,
  question_manifest_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'applied', 'failed', 'recovery_required')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_desktop_sync_batch_backups_status_created
  ON desktop_sync_batch_backups(status, created_at);

CREATE TABLE IF NOT EXISTS desktop_device_session_challenges (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  credential_version INTEGER NOT NULL CHECK (credential_version >= 1),
  nonce_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled')),
  nonce_issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  issued_session_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (authorization_id) REFERENCES desktop_device_authorizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_desktop_device_session_challenges_device_status
  ON desktop_device_session_challenges(device_id, status, expires_at);

CREATE TABLE IF NOT EXISTS desktop_sessions (
  sid TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  active_role TEXT NOT NULL CHECK (active_role IN ('super_admin', 'admin', 'teacher', 'student')),
  eligible_roles_json TEXT NOT NULL,
  auth_version INTEGER NOT NULL CHECK (auth_version >= 1),
  credential_version INTEGER NOT NULL CHECK (credential_version >= 1),
  auth_time TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoke_reason TEXT,
  revoked_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (authorization_id) REFERENCES desktop_device_authorizations(id)
);

CREATE INDEX IF NOT EXISTS idx_desktop_sessions_device_status
  ON desktop_sessions(device_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_desktop_sessions_user_status
  ON desktop_sessions(user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS primary_host_operation_challenges (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('bootstrap', 'transfer', 'recovery')),
  requested_by_user_id TEXT NOT NULL,
  requested_by_device_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_phone'
    CHECK (status IN ('pending_phone', 'identity_verified', 'consumed', 'expired', 'cancelled')),
  verified_user_id TEXT,
  verified_login_event_id TEXT UNIQUE,
  phone_verified_at TEXT,
  expires_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  FOREIGN KEY (verified_user_id) REFERENCES users(id),
  FOREIGN KEY (verified_login_event_id) REFERENCES miniapp_login_events(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_primary_host_challenge_active_request
  ON primary_host_operation_challenges(operation, requested_by_user_id, target_device_id)
  WHERE status IN ('pending_phone', 'identity_verified');

CREATE INDEX IF NOT EXISTS idx_primary_host_challenge_status_expiry
  ON primary_host_operation_challenges(status, expires_at);

CREATE TABLE IF NOT EXISTS primary_host_epochs (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL UNIQUE CHECK (generation >= 1),
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired', 'recovery_superseded')),
  activation_reason TEXT NOT NULL CHECK (activation_reason IN ('bootstrap', 'transfer', 'recovery')),
  source_epoch_id TEXT,
  challenge_id TEXT NOT NULL,
  db_instance_digest TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  store_id TEXT NOT NULL,
  db_authority_id TEXT NOT NULL,
  host_credential_hash TEXT NOT NULL,
  host_public_key TEXT,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  retired_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (authorization_id) REFERENCES desktop_device_authorizations(id),
  FOREIGN KEY (source_epoch_id) REFERENCES primary_host_epochs(id),
  FOREIGN KEY (challenge_id) REFERENCES primary_host_operation_challenges(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_primary_host_single_active
  ON primary_host_epochs(status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_primary_host_device_generation
  ON primary_host_epochs(device_id, generation DESC);

CREATE TABLE IF NOT EXISTS host_transfers (
  id TEXT PRIMARY KEY,
  source_epoch_id TEXT NOT NULL,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  target_generation INTEGER NOT NULL UNIQUE CHECK (target_generation >= 2),
  target_device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_validation'
    CHECK (status IN ('pending_validation', 'activated', 'cancelled', 'expired')),
  validation_manifest_hash TEXT,
  last_failure_code TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT,
  FOREIGN KEY (source_epoch_id) REFERENCES primary_host_epochs(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (challenge_id) REFERENCES primary_host_operation_challenges(id)
);

CREATE TABLE IF NOT EXISTS primary_host_preflight_proofs (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK (operation IN ('transfer', 'recovery')),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  authorization_row_version INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  session_row_version INTEGER NOT NULL,
  auth_version INTEGER NOT NULL,
  credential_version INTEGER NOT NULL,
  challenge_id TEXT NOT NULL,
  challenge_row_version INTEGER NOT NULL,
  transfer_id TEXT,
  transfer_row_version INTEGER,
  source_epoch_id TEXT NOT NULL,
  source_epoch_row_version INTEGER NOT NULL,
  source_generation INTEGER NOT NULL,
  target_generation INTEGER NOT NULL,
  local_manifest_hash TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  local_receipt_nonce TEXT NOT NULL,
  local_receipt_signature_hash TEXT NOT NULL,
  cloud_preflight_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'consumed')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (authorization_id) REFERENCES desktop_device_authorizations(id),
  FOREIGN KEY (session_id) REFERENCES desktop_sessions(sid),
  FOREIGN KEY (challenge_id) REFERENCES primary_host_operation_challenges(id),
  FOREIGN KEY (transfer_id) REFERENCES host_transfers(id),
  FOREIGN KEY (source_epoch_id) REFERENCES primary_host_epochs(id)
);

CREATE INDEX IF NOT EXISTS idx_primary_host_preflight_proofs_context
  ON primary_host_preflight_proofs(operation, challenge_id, transfer_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_host_transfers_status_created
  ON host_transfers(status, created_at DESC);

CREATE TABLE IF NOT EXISTS host_recovery_factors (
  id TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  factor_hash TEXT NOT NULL,
  factor_salt TEXT NOT NULL,
  kdf_params_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked')),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  used_at TEXT,
  used_by_device_id TEXT,
  revoked_at TEXT,
  FOREIGN KEY (epoch_id) REFERENCES primary_host_epochs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_host_recovery_factor_active_epoch
  ON host_recovery_factors(epoch_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_host_recovery_factor_user_status
  ON host_recovery_factors(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS host_recovery_deliveries (
  id TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL,
  factor_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  recipient_key_fingerprint TEXT NOT NULL,
  recipient_public_key_pem TEXT,
  ack_nonce TEXT,
  envelope_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'acknowledged')),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  acknowledged_at TEXT,
  FOREIGN KEY (epoch_id) REFERENCES primary_host_epochs(id),
  FOREIGN KEY (factor_id) REFERENCES host_recovery_factors(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_host_recovery_deliveries_epoch
  ON host_recovery_deliveries(epoch_id);

CREATE INDEX IF NOT EXISTS idx_host_recovery_deliveries_target_pending
  ON host_recovery_deliveries(user_id, device_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_authorizations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_teacher_id TEXT,
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

-- ===================== 小程序只读快照 / 云端任务 =====================
CREATE TABLE IF NOT EXISTS readonly_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS miniapp_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_host',
  payload TEXT NOT NULL,
  result_payload TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT,
  request_hash TEXT,
  target_host_device_id TEXT,
  selection_context TEXT,
  phase TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claim_token_hash TEXT,
  lease_expires_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  cancel_requested_at TEXT
);

CREATE TABLE IF NOT EXISTS host_heartbeats (
  id TEXT PRIMARY KEY,
  host_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online',
  base_url TEXT,
  lan_urls TEXT,
  capabilities TEXT,
  last_snapshot_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  storage_state TEXT NOT NULL DEFAULT 'local_draft' CHECK(storage_state IN ('local_draft', 'host_committed')),
  committed_at TEXT,
  committed_by_device_id TEXT,
  source_device_id TEXT,
  owner_user_id TEXT,
  taxonomy_json TEXT NOT NULL DEFAULT '{}',
  deleted INTEGER DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authority_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_bank_store_bindings (
  store_id TEXT PRIMARY KEY,
  db_authority_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  bound_by TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS question_bank_storage_audit (
  id TEXT PRIMARY KEY,
  operation_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  store_id TEXT,
  question_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_bank_delete_operations (
  operation_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  trash_relative_path TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  manifest_before_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  restored_at TEXT
);

CREATE TABLE IF NOT EXISTS question_contents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  question_id TEXT NOT NULL,
  stem TEXT NOT NULL,
  answer TEXT,
  explanation TEXT,
  options_json TEXT,
  rich_content_json TEXT,
  search_text TEXT,
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

CREATE TABLE IF NOT EXISTS taxonomy_systems (
  id TEXT NOT NULL,
  tenant_id TEXT DEFAULT 'default',
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS taxonomy_state (
  tenant_id TEXT PRIMARY KEY,
  initialized_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_nodes (
  id TEXT NOT NULL,
  tenant_id TEXT DEFAULT 'default',
  system_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS question_taxonomy_nodes (
  question_id TEXT NOT NULL,
  system_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, system_id, node_id)
);

CREATE TABLE IF NOT EXISTS taxonomy_deletion_backups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  entity_type TEXT NOT NULL,
  system_id TEXT NOT NULL,
  node_id TEXT,
  affected_question_count INTEGER NOT NULL DEFAULT 0,
  deleted_node_count INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,
  created_by TEXT DEFAULT 'system',
  created_at TEXT NOT NULL,
  restored_by TEXT,
  restored_at TEXT
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
CREATE INDEX IF NOT EXISTS idx_readonly_snapshots_type_created ON readonly_snapshots(snapshot_type, created_at);
CREATE INDEX IF NOT EXISTS idx_miniapp_tasks_status_created ON miniapp_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_miniapp_login_events_created ON miniapp_login_events(created_at);
CREATE INDEX IF NOT EXISTS idx_miniapp_login_events_user_created ON miniapp_login_events(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_applications_user_idempotency
  ON miniapp_role_applications(applicant_user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_applications_active_user
  ON miniapp_role_applications(applicant_user_id)
  WHERE status IN ('submitted', 'provisioning', 'manual_resolution_required');
CREATE INDEX IF NOT EXISTS idx_miniapp_applications_status_created
  ON miniapp_role_applications(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_wechat_binding_active_openid
  ON miniapp_wechat_binding_requests(candidate_openid)
  WHERE status = 'submitted';
CREATE UNIQUE INDEX IF NOT EXISTS idx_miniapp_wechat_binding_active_user
  ON miniapp_wechat_binding_requests(target_user_id)
  WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS idx_miniapp_wechat_binding_status_created
  ON miniapp_wechat_binding_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_memberships_status_subject
  ON account_memberships(status, subject_type, subject_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_receipts_request
  ON identity_provisioning_receipts(application_id, revision, request_hash);
CREATE INDEX IF NOT EXISTS idx_host_heartbeats_updated ON host_heartbeats(updated_at);
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
CREATE INDEX IF NOT EXISTS idx_taxonomy_systems_subject ON taxonomy_systems(tenant_id, subject, deleted, sort_order);
CREATE INDEX IF NOT EXISTS idx_taxonomy_nodes_system ON taxonomy_nodes(tenant_id, system_id, parent_id, deleted, sort_order);
CREATE INDEX IF NOT EXISTS idx_question_taxonomy_question ON question_taxonomy_nodes(question_id, system_id);
CREATE INDEX IF NOT EXISTS idx_question_taxonomy_node ON question_taxonomy_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_deletion_backups_tenant_created
  ON taxonomy_deletion_backups(tenant_id, created_at);
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
