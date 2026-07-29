-- ===================== 用户表 =====================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  openid TEXT UNIQUE,                    -- 微信 openid (教师/学生登录用)
  phone TEXT,
  phone_normalized TEXT,
  name TEXT NOT NULL,
  avatar TEXT,
  user_type TEXT NOT NULL DEFAULT 'student',  -- 'admin' | 'teacher' | 'student' | 'invited'
  tenant_id TEXT NOT NULL DEFAULT 'default',
  status INTEGER DEFAULT 1,             -- 1:正常 0:禁用
  login_enabled INTEGER DEFAULT 0,
  student_id TEXT,
  linked_student_ids TEXT,
  teacher_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  is_super_admin_identity INTEGER DEFAULT 0,
  auth_version INTEGER NOT NULL DEFAULT 1,
  invited_by TEXT,                       -- 邀请人ID (仅 invited 类型)
  invite_code TEXT,                      -- 邀请码 (仅 invited 类型)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 模块注册表 =====================
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  route_prefix TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ===================== 权限定义表 =====================
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  sub_module TEXT,
  action TEXT NOT NULL,                  -- 'view' | 'edit' | 'delete' | 'export' | 'admin'
  description TEXT,
  allowed_types TEXT DEFAULT '["admin"]',  -- 允许的用户类型 JSON
  is_default INTEGER DEFAULT 0,
  FOREIGN KEY (module_id) REFERENCES modules(id)
);

-- ===================== 用户-模块权限表 =====================
CREATE TABLE IF NOT EXISTS user_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  granted_by TEXT,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  status INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id),
  UNIQUE(user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS authorization_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  target_user_id TEXT,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

-- ===================== 邀请记录表 =====================
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  invited_by TEXT NOT NULL,
  target_name TEXT,
  target_phone TEXT,
  permissions TEXT DEFAULT '[]',         -- 预分配权限列表 JSON
  status INTEGER DEFAULT 0,             -- 0:待使用 1:已使用 2:已过期
  expires_at TEXT NOT NULL,
  used_by TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS host_heartbeats (
  id TEXT PRIMARY KEY,
  host_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online',
  base_url TEXT,
  lan_urls TEXT,
  last_snapshot_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS cloud_devices (
  id TEXT PRIMARY KEY,
  device_name TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  owner_user_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS desktop_device_pairings (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL, device_name TEXT, phone TEXT, secret_hash TEXT NOT NULL,
  pairing_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL,
  approved_by TEXT, user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, exchanged_at TEXT
);

CREATE TABLE IF NOT EXISTS desktop_pairing_capabilities (
  host_device_id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL UNIQUE,
  protocol_version TEXT NOT NULL,
  public_key TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_desktop_pairing_capabilities_status_expiry
  ON desktop_pairing_capabilities(status, expires_at);

CREATE TABLE IF NOT EXISTS desktop_pairing_relay_requests (
  id TEXT PRIMARY KEY,
  target_host_device_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  envelope_hash TEXT NOT NULL UNIQUE,
  request_secret_hash TEXT NOT NULL,
  source_address_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_host'
    CHECK (status IN ('pending_host', 'processing', 'completed', 'rejected', 'expired')),
  result_payload TEXT,
  error_code TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  result_read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_desktop_pairing_relay_requests_target_status
  ON desktop_pairing_relay_requests(target_host_device_id, status, created_at);

-- Authority control plane. These are control records and never canonical
-- course, schedule, finance, or question-bank business data.
CREATE TABLE IF NOT EXISTS authority_accounts (
  user_id TEXT NOT NULL,
  authority_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, authority_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS authority_migration_ledger (
  name TEXT PRIMARY KEY,
  source_fingerprint TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_gateway_authority_projections_epoch_version
  ON authority_scoped_projections(authority_id, host_epoch_id, source_version);

CREATE TABLE IF NOT EXISTS authority_role_mirror_versions (
  authority_id TEXT PRIMARY KEY,
  host_epoch_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 0),
  payload_hash TEXT NOT NULL,
  projection_signature TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_application_mirrors (
  authority_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  host_epoch_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 0),
  user_id TEXT NOT NULL,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('student', 'teacher')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  payload_json TEXT NOT NULL,
  projection_signature TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (authority_id, application_id)
);

CREATE INDEX IF NOT EXISTS idx_role_application_mirrors_status
  ON role_application_mirrors(authority_id, status, source_version);

CREATE TABLE IF NOT EXISTS role_grant_mirrors (
  authority_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  host_epoch_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 0),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'super_admin')),
  grant_version INTEGER NOT NULL CHECK (grant_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'pending')),
  payload_json TEXT NOT NULL,
  projection_signature TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (authority_id, binding_id)
);

CREATE INDEX IF NOT EXISTS idx_role_grant_mirrors_user
  ON role_grant_mirrors(authority_id, user_id, role, status);

CREATE TABLE IF NOT EXISTS authority_role_bindings (
  binding_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'super_admin')),
  subject_type TEXT,
  subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'pending')),
  grant_version INTEGER NOT NULL DEFAULT 1 CHECK (grant_version >= 1),
  granted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_gateway_authority_role_bindings_user
  ON authority_role_bindings(authority_id, user_id, role, status);

CREATE TABLE IF NOT EXISTS authority_device_control_mirror_versions (
  authority_id TEXT PRIMARY KEY,
  host_epoch_id TEXT NOT NULL,
  host_generation INTEGER NOT NULL CHECK (host_generation >= 1),
  source_version INTEGER NOT NULL CHECK (source_version >= 0),
  snapshot_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS device_activations (
  activation_id TEXT PRIMARY KEY,
  authority_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('activation_pending', 'active', 'expired', 'cancelled')),
  expires_at TEXT NOT NULL,
  finalized_at TEXT,
  receipt_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS primary_host_epochs (
    id TEXT PRIMARY KEY,
    db_authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    device_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'retired', 'recovery_superseded')),
    host_credential_hash TEXT NOT NULL,
    host_public_key TEXT NOT NULL,
    credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  retired_at TEXT,
  UNIQUE(db_authority_id, generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_primary_host_active_authority
  ON primary_host_epochs(db_authority_id) WHERE status='active';

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
