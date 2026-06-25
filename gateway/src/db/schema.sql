-- ===================== 用户表 =====================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  openid TEXT UNIQUE,                    -- 微信 openid (教师/学生登录用)
  phone TEXT,
  name TEXT NOT NULL,
  avatar TEXT,
  user_type TEXT NOT NULL DEFAULT 'student',  -- 'admin' | 'teacher' | 'student' | 'invited'
  status INTEGER DEFAULT 1,             -- 1:正常 0:禁用
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
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_devices (
  id TEXT PRIMARY KEY,
  device_name TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
